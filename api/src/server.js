import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import pg from 'pg';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const { Pool } = pg;

const fastify = Fastify({ logger: true });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'ecommerce_db',
});

pool.on('error', (err) => console.error('DB Error:', err));

const API_TOKEN = process.env.API_TOKEN || 'ecommerce-api-token';
const API_WRITE_KEY = process.env.API_WRITE_KEY || API_TOKEN;

await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Write-Key'],
});

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

function validateTableName(table) {
  return /^[a-z_][a-z0-9_]{0,63}$/.test(table);
}
function validateId(id) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

const authMiddleware = async (req, reply) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== API_TOKEN) {
    reply.code(401).send({ success: false, error: 'Unauthorized' });
    return;
  }
};

const writeAuthMiddleware = async (req, reply) => {
  const writeKey = req.headers['x-write-key'];
  const authToken = req.headers.authorization?.replace('Bearer ', '');

  if (!writeKey && !authToken) {
    reply.code(403).send({ success: false, error: 'Write access denied' });
    return;
  }

  if (writeKey && writeKey !== API_WRITE_KEY) {
    reply.code(403).send({ success: false, error: 'Invalid write key' });
    return;
  }

  if (authToken && authToken !== API_TOKEN) {
    reply.code(403).send({ success: false, error: 'Invalid token' });
    return;
  }
};

fastify.get('/health', async () => {
  try {
    await pool.query('SELECT 1');
    return { status: 'healthy', database: 'connected', timestamp: new Date().toISOString() };
  } catch (err) {
    return { status: 'unhealthy', database: 'disconnected', error: err.message };
  }
});

fastify.get('/ping', async () => ({ pong: true }));

let botStatus = { qr: null, connected: false };

fastify.get('/api/qrcode', async () => botStatus);

fastify.post('/api/qrcode', { preHandler: writeAuthMiddleware }, async (req, res) => {
  const { qr, connected } = req.body || {};
  if (qr !== undefined) botStatus.qr = qr;
  if (connected !== undefined) botStatus.connected = connected;
  return { success: true };
});

fastify.get('/data/:table', async (req, res) => {
  const { table } = req.params;
  if (!validateTableName(table)) {
    return res.code(400).send({ error: 'Invalid table name' });
  }
  try {
    const result = await query(`SELECT * FROM "${table}" ORDER BY created_at DESC LIMIT 500`);
    return res.code(200).send(result.rows);
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.get('/config/:chave', async (req, res) => {
  const { chave } = req.params;
  try {
    const result = await query('SELECT valor FROM configuracoes WHERE chave = $1', [chave]);
    if (!result.rows.length) {
      return res.code(200).send({ data: null });
    }
    try {
      return res.code(200).send({ data: JSON.parse(result.rows[0].valor) });
    } catch {
      return res.code(200).send({ data: result.rows[0].valor });
    }
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/config/set', { preHandler: authMiddleware }, async (req, res) => {
  const { chave, valor } = req.body || {};
  if (!chave) {
    return res.code(400).send({ error: 'Chave requerida' });
  }
  const valorJson = typeof valor === 'object' ? JSON.stringify(valor) : valor;
  try {
    const result = await query(
      "INSERT INTO configuracoes (id, chave, valor, updated_at) VALUES (gen_random_uuid(), $1, $2, NOW()) ON CONFLICT (chave) DO UPDATE SET valor = $2, updated_at = NOW() RETURNING *",
      [chave, valorJson]
    );
    return { success: true, data: result.rows[0] };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/read', { preHandler: authMiddleware }, async (req, res) => {
  const { table, filters = {}, columns = ['*'], order_by = 'created_at', order_dir = 'DESC', limit = 100, offset = 0 } = req.body || {};
  if (!validateTableName(table)) {
    return res.code(400).send({ error: 'Invalid request' });
  }
  if (!validateTableName(order_by)) {
    return res.code(400).send({ error: 'Invalid order_by' });
  }
  const colList = (!columns || (Array.isArray(columns) && columns.length === 1 && columns[0] === '*'))
    ? '*' : columns.map(c => '"' + c + '"').join(', ');

  const entries = Object.entries(filters);
  const conditions = entries.map(([k], i) => {
    if (!validateTableName(k)) return null;
    return Array.isArray(filters[k])
      ? '"' + k + '" IN (' + filters[k].map((_, j) => '$' + (i + j + 1)).join(',') + ')'
      : '"' + k + '" = $' + (i + 1);
  }).filter(Boolean).join(' AND ');
  const params = Object.values(filters).flat();
  const lim = Math.min(parseInt(limit) || 100, 1000);

  try {
    const [countRes, dataRes] = await Promise.all([
      query('SELECT COUNT(*) FROM "' + table + '"' + (conditions ? ' WHERE ' + conditions : ''), params),
      query('SELECT ' + colList + ' FROM "' + table + '"' + (conditions ? ' WHERE ' + conditions : '')
        + ' ORDER BY "' + order_by + '" ' + (order_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC')
        + ' LIMIT ' + lim + ' OFFSET ' + offset, params),
    ]);

    return {
      data: dataRes.rows,
      pagination: { total: parseInt(countRes.rows[0].count), limit: lim, offset },
    };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/create', { preHandler: writeAuthMiddleware }, async (req, res) => {
  const { table, data } = req.body || {};
  if (!validateTableName(table) || !data) {
    return res.code(400).send({ error: 'Invalid request' });
  }
  const sanitized = {};
  for (const [k, v] of Object.entries(data)) {
    if (validateTableName(k)) sanitized[k] = v;
  }
  sanitized.id = sanitized.id || crypto.randomUUID();
  sanitized.created_at = sanitized.created_at || new Date().toISOString();
  const cols = Object.keys(sanitized).map(c => '"' + c + '"').join(', ');
  const vals = Object.keys(sanitized).map((_, i) => '$' + (i + 1)).join(', ');
  try {
    const result = await query(
      'INSERT INTO "' + table + '" (' + cols + ') VALUES (' + vals + ') RETURNING *',
      Object.values(sanitized)
    );
    return { success: true, data: result.rows[0] };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/update', { preHandler: writeAuthMiddleware }, async (req, res) => {
  const { table, id, data } = req.body || {};
  if (!validateTableName(table) || !validateId(id) || !data) {
    return res.code(400).send({ error: 'Invalid request' });
  }
  const sanitized = {};
  for (const [k, v] of Object.entries(data)) {
    if (validateTableName(k) && !['id', 'created_at'].includes(k)) sanitized[k] = v;
  }
  if (!Object.keys(sanitized).length) return res.code(400).send({ error: 'No valid fields' });
  const sets = Object.keys(sanitized).map((k, i) => '"' + k + '" = $' + (i + 1)).join(', ');
  try {
    const result = await query(
      'UPDATE "' + table + '" SET ' + sets + ' WHERE id = $' + (Object.keys(sanitized).length + 1) + ' RETURNING *',
      [...Object.values(sanitized), id]
    );
    if (!result.rows.length) return res.code(404).send({ error: 'Not found' });
    return { success: true, data: result.rows[0] };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/delete', { preHandler: writeAuthMiddleware }, async (req, res) => {
  const { table, id } = req.body || {};
  if (!validateTableName(table) || !validateId(id)) {
    return res.code(400).send({ error: 'Invalid request' });
  }
  try {
    const result = await query('DELETE FROM "' + table + '" WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return res.code(404).send({ error: 'Not found' });
    return { success: true, deleted: true, id };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/table/create', { preHandler: authMiddleware }, async (req, res) => {
  const { table_name, columns } = req.body || {};
  if (!table_name || !columns) {
    return res.code(400).send({ error: 'Invalid request' });
  }
  if (!validateTableName(table_name)) {
    return res.code(400).send({ error: 'Invalid table name' });
  }
  try {
    await query('CREATE TABLE IF NOT EXISTS "' + table_name + '" (' + columns + ')');
    return { success: true, table: table_name };
  } catch (e) {
    return res.code(400).send({ error: e.message });
  }
});

fastify.get('/api/produtos', async (req, res) => {
  const { categoria, search, limit = 50, offset = 0 } = req.query;
  try {
    let sql = 'SELECT * FROM "produtos" WHERE ativo = true';
    const params = [];
    if (categoria) {
      params.push(categoria);
      sql += ' AND categoria = $' + params.length;
    }
    if (search) {
      params.push('%' + search + '%');
      sql += ' AND (nome ILIKE $' + params.length + ' OR descricao ILIKE $' + params.length + ')';
    }
    sql += ' ORDER BY created_at DESC LIMIT ' + parseInt(limit) + ' OFFSET ' + parseInt(offset);
    const result = await query(sql, params);
    return { success: true, data: result.rows, total: result.rows.length };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.get('/api/produtos/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM "produtos" WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.code(404).send({ error: 'Produto nao encontrado' });
    return { success: true, data: result.rows[0] };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/produtos', { preHandler: writeAuthMiddleware }, async (req, res) => {
  const { id, nome, descricao, preco, categoria, imagem, estoque } = req.body || {};
  if (!nome || preco === undefined || !categoria) {
    return res.code(400).send({ error: 'nome, preco e categoria sao obrigatorios' });
  }
  const productId = id || crypto.randomUUID().split('-')[0];
  try {
    const result = await query(
      'INSERT INTO "produtos" (id, nome, descricao, preco, categoria, imagem, estoque) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET nome = $2, descricao = $3, preco = $4, categoria = $5, imagem = $6, estoque = $7 RETURNING *',
      [productId, nome, descricao || '', parseFloat(preco), categoria, imagem || '', parseInt(estoque) || 0]
    );
    return { success: true, data: result.rows[0] };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.put('/api/produtos/:id', { preHandler: writeAuthMiddleware }, async (req, res) => {
  const { nome, descricao, preco, categoria, imagem, estoque, ativo } = req.body || {};
  try {
    const sets = [];
    const params = [];
    if (nome !== undefined) { sets.push('nome = $' + (params.length + 1)); params.push(nome); }
    if (descricao !== undefined) { sets.push('descricao = $' + (params.length + 1)); params.push(descricao); }
    if (preco !== undefined) { sets.push('preco = $' + (params.length + 1)); params.push(parseFloat(preco)); }
    if (categoria !== undefined) { sets.push('categoria = $' + (params.length + 1)); params.push(categoria); }
    if (imagem !== undefined) { sets.push('imagem = $' + (params.length + 1)); params.push(imagem); }
    if (estoque !== undefined) { sets.push('estoque = $' + (params.length + 1)); params.push(parseInt(estoque)); }
    if (ativo !== undefined) { sets.push('ativo = $' + (params.length + 1)); params.push(ativo); }
    if (!sets.length) return res.code(400).send({ error: 'Nenhum campo para atualizar' });
    params.push(req.params.id);
    const result = await query(
      'UPDATE "produtos" SET ' + sets.join(', ') + ', updated_at = NOW() WHERE id = $' + params.length + ' RETURNING *',
      params
    );
    if (!result.rows.length) return res.code(404).send({ error: 'Produto nao encontrado' });
    return { success: true, data: result.rows[0] };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.delete('/api/produtos/:id', { preHandler: writeAuthMiddleware }, async (req, res) => {
  try {
    const result = await query('DELETE FROM "produtos" WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.code(404).send({ error: 'Produto nao encontrado' });
    return { success: true, deleted: true, id: req.params.id };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/produtos/seed', { preHandler: writeAuthMiddleware }, async (req, res) => {
  try {
    const filePath = path.join(PROJECT_ROOT, 'data', 'produtos.json');
    if (!fs.existsSync(filePath)) return res.code(404).send({ error: 'Arquivo produtos.json nao encontrado' });
    const raw = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
    let count = 0;
    for (const [categoria, items] of Object.entries(raw)) {
      for (const item of items) {
        await query(
          'INSERT INTO "produtos" (id, nome, descricao, preco, categoria, imagem, estoque) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING',
          [item.id, item.nome, item.descricao || '', parseFloat(item.preco), categoria, item.imagem || '', parseInt(item.estoque) || 0]
        );
        count++;
      }
    }
    return { success: true, message: count + ' produtos importados' };
  } catch (err) {
    return res.code(500).send({ error: err.message });
  }
});

fastify.post('/api/seed/all', { preHandler: writeAuthMiddleware }, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- 1. Empresa ---
    const empresaId = 'empresa001';
    await client.query(
      `INSERT INTO "empresas" (id, nome, cnpj, telefone, email, endereco, cidade, whatsapp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET nome = $2, telefone = $4, whatsapp = $8`,
      [empresaId, 'Loja Exemplo Tech', '00.000.000/0001-01', '(11) 99999-8888', 'contato@lojaexemplo.com.br',
       'Rua das Flores, 123', 'São Paulo - SP', '5511999998888']
    );

    // --- 2. Produtos ---
    const produtos = [
      { id: 'p001', nome: 'Notebook Ultra i7', descricao: '16GB RAM, SSD 512GB, Tela 15.6"', preco: 4299.90, categoria: 'eletronicos', estoque: 10 },
      { id: 'p002', nome: 'Mouse Sem Fio', descricao: 'Ergonômico, 6 botões, bateria 12 meses', preco: 89.90, categoria: 'eletronicos', estoque: 25 },
      { id: 'p003', nome: 'Teclado Mecânico RGB', descricao: 'Switch Blue, ABNT2, cabo USB-C', preco: 199.90, categoria: 'eletronicos', estoque: 15 },
      { id: 'p004', nome: 'Monitor 27" 4K', descricao: 'IPS, HDR10, 60Hz, HDMI+DP', preco: 2199.90, categoria: 'eletronicos', estoque: 5 },
      { id: 'p005', nome: 'Camiseta Algodão Premium', descricao: 'Tamanhos P ao GG, 5 cores', preco: 59.90, categoria: 'moda', estoque: 40 },
      { id: 'p006', nome: 'Tênis Casual Comfort', descricao: 'Couro sintético, palmilha ortopédica', preco: 189.90, categoria: 'moda', estoque: 20 },
      { id: 'p007', nome: 'Relógio Digital Esportivo', descricao: 'Cronômetro, GPS, resistente água', preco: 349.90, categoria: 'moda', estoque: 12 },
      { id: 'p008', nome: 'Luminária LED Mesa', descricao: 'Braço articulado, 3 modos de cor', preco: 79.90, categoria: 'casa', estoque: 18 },
      { id: 'p009', nome: 'Organizador de Gavetas', descricao: 'Acrílico, 10 divisórias ajustáveis', preco: 39.90, categoria: 'casa', estoque: 30 },
    ];
    for (const p of produtos) {
      await client.query(
        'INSERT INTO "produtos" (id, nome, descricao, preco, categoria, estoque, empresa_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
        [p.id, p.nome, p.descricao, p.preco, p.categoria, p.estoque, empresaId]
      );
    }

    // --- 3. Clientes ---
    const clientes = [
      { id: '5511999990001@c.us', nome: 'Ana Silva', telefone: '5511999990001', endereco: 'Av. Paulista, 1000', cidade: 'São Paulo - SP' },
      { id: '5511999990002@c.us', nome: 'Carlos Oliveira', telefone: '5511999990002', endereco: 'Rua Augusta, 500', cidade: 'São Paulo - SP' },
      { id: '5511999990003@c.us', nome: 'Marina Santos', telefone: '5511999990003', endereco: 'Rua Oscar Freire, 200', cidade: 'São Paulo - SP' },
    ];
    for (const c of clientes) {
      await client.query(
        'INSERT INTO "clientes" (id, nome, telefone, endereco, cidade) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
        [c.id, c.nome, c.telefone, c.endereco, c.cidade]
      );
    }

    // --- 4. Carrinhos ---
    const carrinhoId1 = crypto.randomUUID();
    const carrinhoId2 = crypto.randomUUID();
    await client.query(
      `INSERT INTO "carrinhos" (id, cliente_id, cliente_nome, itens, total, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [carrinhoId1, '5511999990001@c.us', 'Ana Silva',
       JSON.stringify([{ id: 'p002', nome: 'Mouse Sem Fio', preco: 89.90, qtd: 2 }, { id: 'p005', nome: 'Camiseta Algodão Premium', preco: 59.90, qtd: 1 }]),
       239.70, 'ativo']
    );
    await client.query(
      `INSERT INTO "carrinhos" (id, cliente_id, cliente_nome, itens, total, status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [carrinhoId2, '5511999990002@c.us', 'Carlos Oliveira',
       JSON.stringify([{ id: 'p001', nome: 'Notebook Ultra i7', preco: 4299.90, qtd: 1 }]),
       4299.90, 'ativo']
    );

    // --- 5. Pedidos ---
    const pedidoId1 = crypto.randomUUID();
    const pedidoId2 = crypto.randomUUID();
    await client.query(
      `INSERT INTO "pedidos" (id, cliente_id, cliente_nome, cliente_telefone, itens, total, status, forma_pagamento) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [pedidoId1, '5511999990003@c.us', 'Marina Santos', '5511999990003',
       JSON.stringify([{ id: 'p006', nome: 'Tênis Casual Comfort', preco: 189.90, qtd: 1 }, { id: 'p008', nome: 'Luminária LED Mesa', preco: 79.90, qtd: 2 }]),
       349.70, 'entregue', 'pix']
    );
    await client.query(
      `INSERT INTO "pedidos" (id, cliente_id, cliente_nome, cliente_telefone, itens, total, status, forma_pagamento) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [pedidoId2, '5511999990001@c.us', 'Ana Silva', '5511999990001',
       JSON.stringify([{ id: 'p004', nome: 'Monitor 27" 4K', preco: 2199.90, qtd: 1 }]),
       2199.90, 'pendente', 'whatsapp']
    );

    await client.query('COMMIT');

    return {
      success: true,
      message: 'Base populada com sucesso',
      data: {
        empresa: empresaId,
        produtos: produtos.length,
        clientes: clientes.length,
        carrinhos: 2,
        pedidos: 2,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    return res.code(500).send({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

const TABLES = [
  { name: 'empresas', columns: 'id TEXT PRIMARY KEY, nome TEXT, cnpj TEXT, telefone TEXT, email TEXT, endereco TEXT, cidade TEXT, whatsapp TEXT, ativo BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()' },
  { name: 'produtos', columns: 'id TEXT PRIMARY KEY, nome TEXT, descricao TEXT, preco DECIMAL(10,2), categoria TEXT, imagem TEXT, estoque INTEGER DEFAULT 0, ativo BOOLEAN DEFAULT true, empresa_id TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()' },
  { name: 'clientes', columns: 'id TEXT PRIMARY KEY, nome TEXT, telefone TEXT, endereco TEXT, cidade TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()' },
  { name: 'carrinhos', columns: 'id UUID PRIMARY KEY, cliente_id TEXT, cliente_nome TEXT, itens JSONB DEFAULT \'[]\'::jsonb, total DECIMAL(10,2) DEFAULT 0, status TEXT DEFAULT \'ativo\', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()' },
  { name: 'pedidos', columns: 'id UUID PRIMARY KEY, cliente_id TEXT, cliente_nome TEXT, cliente_telefone TEXT, itens JSONB DEFAULT \'[]\'::jsonb, total DECIMAL(10,2), status TEXT DEFAULT \'pendente\', forma_pagamento TEXT, observacoes TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()' },
  { name: 'contatos', columns: 'id UUID PRIMARY KEY, nome TEXT, email TEXT, telefone TEXT, mensagem TEXT, lido BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()' },
  { name: 'configuracoes', columns: 'id UUID PRIMARY KEY DEFAULT gen_random_uuid(), chave TEXT UNIQUE, valor TEXT, updated_at TIMESTAMP DEFAULT NOW()' },
];

async function initDB() {
  for (const table of TABLES) {
    try {
      await query('CREATE TABLE IF NOT EXISTS "' + table.name + '" (' + table.columns + ')');
      console.log('Tabela "' + table.name + '" verificada/criada');
    } catch (e) {
      console.error('Erro ao criar tabela "' + table.name + '":', e.message);
    }
  }
}

const start = async () => {
  await initDB();
  const PORT = process.env.PORT || 3000;
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log('Server: http://0.0.0.0:' + PORT);
};

start();
