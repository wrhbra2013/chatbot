import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
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

fastify.get('/api/config', async () => ({
  token: API_TOKEN,
  writeKey: API_WRITE_KEY,
  project: 'ecommerce',
}));

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

const TABLES = [
  { name: 'produtos', columns: 'id UUID PRIMARY KEY, nome TEXT, descricao TEXT, preco DECIMAL(10,2), categoria TEXT, imagem TEXT, estoque INTEGER DEFAULT 0, ativo BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW()' },
  { name: 'carrinhos', columns: 'id UUID PRIMARY KEY, cliente_id TEXT, cliente_nome TEXT, itens JSONB DEFAULT \'[]\'::jsonb, total DECIMAL(10,2) DEFAULT 0, status TEXT DEFAULT \'ativo\', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()' },
  { name: 'pedidos', columns: 'id UUID PRIMARY KEY, cliente_id TEXT, cliente_nome TEXT, cliente_telefone TEXT, itens JSONB DEFAULT \'[]\'::jsonb, total DECIMAL(10,2), status TEXT DEFAULT \'pendente\', forma_pagamento TEXT, observacoes TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()' },
  { name: 'contatos', columns: 'id UUID PRIMARY KEY, nome TEXT, email TEXT, telefone TEXT, mensagem TEXT, lido BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()' },
  { name: 'configuracoes', columns: 'id UUID PRIMARY KEY DEFAULT gen_random_uuid(), chave TEXT UNIQUE, valor TEXT, updated_at TIMESTAMP DEFAULT NOW()' },
  { name: 'sessoes', columns: 'id UUID PRIMARY KEY, token TEXT UNIQUE, url_aprovacao TEXT, status TEXT DEFAULT \'pendente\', last_sync TIMESTAMP, access_token TEXT, aprovado_em TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()' },
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

await fastify.register(fastifyStatic, {
  root: PROJECT_ROOT,
  prefix: '/',
  wildcard: false,
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.html$/)) {
      res.setHeader('X-Robots-Tag', 'noindex');
    }
  },
});

fastify.setNotFoundHandler(async (req, res) => {
  const indexPath = path.join(PROJECT_ROOT, 'index.html');
  if (fs.existsSync(indexPath)) {
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    res.type('text/html').send(content);
  } else {
    res.code(404).send('Not Found');
  }
});

const start = async () => {
  await initDB();
  const PORT = process.env.PORT || 3000;
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log('Server: http://0.0.0.0:' + PORT);
};

start();
