const { Client, LocalAuth, List, Buttons, Button, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || 'ecommerce-api-token';
const API_WRITE_KEY = process.env.API_WRITE_KEY || API_TOKEN;

const categorias = ['eletronicos', 'moda', 'casa'];
const nomesCategoria = { eletronicos: '📱 Eletrônicos', moda: '👕 Moda', casa: '🏠 Casa' };

let produtosCache = null;
let carrinhosCache = {};
let ultimaCat = {};

async function api(method, path, body) {
  const url = API_BASE + path;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_TOKEN,
    },
  };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers['X-Write-Key'] = API_WRITE_KEY;
  }
  const res = await fetch(url, opts);
  return res.json();
}

async function getProdutos() {
  if (produtosCache) return produtosCache;
  try {
    const result = await api('GET', '/data/produtos');
    const rows = Array.isArray(result) ? result : (result.data || []);
    const agrupados = {};
    for (const p of rows) {
      const cat = p.categoria || 'geral';
      if (!agrupados[cat]) agrupados[cat] = [];
      agrupados[cat].push(p);
    }
    produtosCache = agrupados;
    return agrupados;
  } catch (e) {
    console.error('Erro ao buscar produtos:', e.message);
    return {};
  }
}

function invalidarCache() {
  produtosCache = null;
}

function fmt(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }

function menuCategorias() {
  return new List(
    '🏪 *Bem-vindo à Sua Loja Online!*\n\nEscolha uma categoria:',
    '📋 Ver categorias',
    [
      {
        title: 'Categorias',
        rows: [
          { id: 'cat_eletronicos', title: '📱 Eletrônicos', description: 'Fones, carregadores, caixas de som' },
          { id: 'cat_moda', title: '👕 Moda', description: 'Camisas, tênis, mochilas' },
          { id: 'cat_casa', title: '🏠 Casa', description: 'Lâmpadas, cadeiras, decoração' },
        ],
      },
      {
        title: 'Opções',
        rows: [
          { id: 'ver_carrinho', title: '🛒 Ver Carrinho', description: 'Itens no seu carrinho' },
          { id: 'ajuda', title: '❓ Ajuda', description: 'Como funciona' },
        ],
      },
    ],
    'Toque para escolher:'
  );
}

function botoesProduto(prod) {
  return new Buttons(
    `*${prod.nome}*\n${prod.descricao || ''}\n\n*Preço:* ${fmt(parseFloat(prod.preco))}\n*Estoque:* ${prod.estoque || 0} un.`,
    [new Button('comprar_' + prod.id, '🛒 Comprar'), new Button('voltar', '⬅️ Voltar')],
    '🛍️ Produto',
    'O que deseja?'
  );
}

function listaProdutos(cat, prods) {
  return new List(
    `*${nomesCategoria[cat]}*\n\nEscolha um produto:`,
    '📱 Ver produtos',
    [{
      title: nomesCategoria[cat],
      rows: prods.map(p => ({
        id: `prod_${cat}_${p.id}`,
        title: p.nome,
        description: `${fmt(parseFloat(p.preco))} - Estoque: ${p.estoque || 0}`,
      })),
    }],
    'Selecione:'
  );
}

async function msgCarrinho(num) {
  const c = carrinhosCache[num] || [];
  if (!c.length) return '🛒 *Carrinho vazio!*\nUse o menu para adicionar produtos.';
  let total = 0;
  const linhas = c.map((i, idx) => {
    total += parseFloat(i.preco) * i.qtd;
    return `${idx + 1}. ${i.nome} x${i.qtd} = ${fmt(parseFloat(i.preco) * i.qtd)}`;
  }).join('\n');
  return `🛒 *Carrinho*\n\n${linhas}\n\n*Total:* ${fmt(total)}\n\nDigite *finalizar* ou *limpar*.`;
}

function textoAjuda() {
  return (
    '❓ *Ajuda*\n\n' +
    '1. Escolha uma categoria no menu\n' +
    '2. Selecione um produto\n' +
    '3. Veja foto e preço\n' +
    '4. Toque em "Comprar"\n' +
    '5. Finalize quando quiser\n\n' +
    'Comandos: *menu* *carrinho* *finalizar* *limpar*'
  );
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'ecommerce-bot' }),
  puppeteer: {
    headless: true,
    executablePath: '/usr/local/bin/ungoogled-chromium',
    args: ['--no-sandbox', '--disable-gpu'],
  },
});

client.on('qr', qr => { qrcode.generate(qr, { small: true }); });
client.on('ready', () => console.log('✅ Chatbot de e-commerce online!'));

client.on('message', async msg => {
  const num = msg.from;
  if (!carrinhosCache[num]) carrinhosCache[num] = [];

  let texto = msg.body;
  let tipo = 'texto';

  if (msg.type === 'buttons_response') {
    tipo = 'botao';
    texto = msg._data && msg._data.selectedButtonId ? msg._data.selectedButtonId : msg.body;
  } else if (msg.type === 'list_response') {
    tipo = 'lista';
    texto = msg._data && msg._data.listResponse && msg._data.listResponse.singleSelectReply
      ? msg._data.listResponse.singleSelectReply.selectedRowId
      : msg.body;
  }

  const t = texto.trim();

  if (t === 'menu' || t === 'inicio' || t === 'oi' || t === 'ola') {
    invalidarCache();
    return client.sendMessage(num, menuCategorias());
  }

  if (t === 'ver_carrinho' || t === 'carrinho') {
    return client.sendMessage(num, await msgCarrinho(num));
  }

  if (t === 'ajuda') { return client.sendMessage(num, textoAjuda()); }

  if (t === 'finalizar') {
    const c = carrinhosCache[num];
    if (!c || !c.length) return client.sendMessage(num, 'Carrinho vazio!');
    const linhas = c.map(i => `${i.nome} x${i.qtd} = ${fmt(parseFloat(i.preco) * i.qtd)}`).join('\n');
    const total = c.reduce((s, i) => s + parseFloat(i.preco) * i.qtd, 0);

    try {
      await api('POST', '/api/create', {
        table: 'pedidos',
        data: {
          cliente_id: num,
          cliente_nome: 'Cliente WhatsApp',
          cliente_telefone: num.replace('@c.us', ''),
          itens: JSON.stringify(c),
          total,
          status: 'pendente',
          forma_pagamento: 'whatsapp',
        },
      });
    } catch (e) {
      console.error('Erro ao salvar pedido:', e.message);
    }

    delete carrinhosCache[num];
    delete ultimaCat[num];
    return client.sendMessage(num, `✅ *Pedido Confirmado!*\n\n${linhas}\n\n*Total:* ${fmt(total)}\n\nUm atendente entrará em contato para pagamento e entrega. 🚚`);
  }

  if (t === 'limpar') { delete carrinhosCache[num]; delete ultimaCat[num]; return client.sendMessage(num, '🗑️ Carrinho limpo!'); }

  if (t === 'voltar') { return client.sendMessage(num, menuCategorias()); }

  if (t.startsWith('cat_')) {
    const cat = t.slice(4);
    const produtos = await getProdutos();
    if (!produtos[cat] || !produtos[cat].length) return;
    ultimaCat[num] = cat;
    return client.sendMessage(num, listaProdutos(cat, produtos[cat]));
  }

  if (t.startsWith('prod_')) {
    const partes = t.split('_');
    const cat = partes[1];
    const prodId = partes.slice(2).join('_');
    const produtos = await getProdutos();
    const prod = produtos[cat]?.find(p => p.id === prodId);
    if (!prod) return;
    try {
      const media = await MessageMedia.fromUrl(prod.imagem || `https://picsum.photos/seed/${prod.id}/400/400`, { unsafeMime: true });
      await client.sendMessage(num, media, { caption: `*${prod.nome}*\n${fmt(parseFloat(prod.preco))}` });
    } catch {}
    return client.sendMessage(num, botoesProduto(prod));
  }

  if (t.startsWith('comprar_')) {
    const prodId = t.slice(8);
    const produtos = await getProdutos();
    for (const cat of categorias) {
      const prod = produtos[cat]?.find(p => p.id === prodId);
      if (prod) {
        const existente = carrinhosCache[num].find(i => i.id === prodId);
        if (existente) { existente.qtd++; }
        else { carrinhosCache[num].push({ id: prodId, nome: prod.nome, preco: prod.preco, qtd: 1 }); }
        return client.sendMessage(num,
          `✅ *${prod.nome}* adicionado ao carrinho!\n\nDigite *carrinho* para ver ou *menu* para continuar.`);
      }
    }
    return client.sendMessage(num, 'Produto não encontrado.');
  }

  const idx = parseInt(t, 10);
  if (!isNaN(idx) && idx >= 1) {
    const produtos = await getProdutos();
    if (ultimaCat[num] && produtos[ultimaCat[num]] && idx <= produtos[ultimaCat[num]].length) {
      const prod = produtos[ultimaCat[num]][idx - 1];
      try {
        const media = await MessageMedia.fromUrl(prod.imagem || `https://picsum.photos/seed/${prod.id}/400/400`, { unsafeMime: true });
        await client.sendMessage(num, media, { caption: `*${prod.nome}*\n${fmt(parseFloat(prod.preco))}` });
      } catch {}
      return client.sendMessage(num, botoesProduto(prod));
    }
    for (const cat of categorias) {
      if (produtos[cat] && idx <= produtos[cat].length) {
        const prod = produtos[cat][idx - 1];
        ultimaCat[num] = cat;
        try {
          const media = await MessageMedia.fromUrl(prod.imagem || `https://picsum.photos/seed/${prod.id}/400/400`, { unsafeMime: true });
          await client.sendMessage(num, media, { caption: `*${prod.nome}*\n${fmt(parseFloat(prod.preco))}` });
        } catch {}
        return client.sendMessage(num, botoesProduto(prod));
      }
    }
    return client.sendMessage(num, 'Número inválido. Digite *menu*.');
  }

  client.sendMessage(num, 'Não entendi. Digite *menu* para começar.');
});

client.initialize();
