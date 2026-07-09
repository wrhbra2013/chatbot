const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || 'ecommerce-api-token';
const API_WRITE_KEY = process.env.API_WRITE_KEY || API_TOKEN;

let carrinhosCache = {};

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

function fmt(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }

async function msgCarrinho(num) {
  const c = carrinhosCache[num] || [];
  if (!c.length) return '🛒 *Carrinho vazio!*\n\nAdicione produtos pelo site: https://wrhbra2013.github.io/chatbot/';
  let total = 0;
  const linhas = c.map((i, idx) => {
    total += parseFloat(i.preco) * i.qtd;
    return idx + 1 + '. ' + i.nome + ' (' + (i.lojaNome || '') + ') x' + i.qtd + ' = ' + fmt(parseFloat(i.preco) * i.qtd);
  }).join('\n');
  return '🛒 *Carrinho*\n\n' + linhas + '\n\n*Total:* ' + fmt(total) + '\n\nDigite *finalizar* ou *limpar*.';
}

function textoAjuda() {
  return (
    '❓ *Ajuda*\n\n' +
    '1. Acesse: https://wrhbra2013.github.io/chatbot/\n' +
    '2. Busque produtos nas lojas disponíveis\n' +
    '3. Adicione ao carrinho e finalize\n\n' +
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
client.on('ready', () => console.log('Chatbot de e-commerce online!'));

client.on('message', async msg => {
  const num = msg.from;
  if (!carrinhosCache[num]) carrinhosCache[num] = [];
  const t = msg.body.trim().toLowerCase();

  if (t === 'menu' || t === 'inicio' || t === 'oi' || t === 'ola') {
    return client.sendMessage(num,
      '🏪 *Busca de Produtos*\n\n' +
      'Acesse o site para buscar produtos nas melhores lojas:\n' +
      'https://wrhbra2013.github.io/chatbot/\n\n' +
      'Comandos:\n' +
      '*carrinho* - Ver carrinho\n' +
      '*finalizar* - Finalizar pedido\n' +
      '*limpar*   - Limpar carrinho\n' +
      '*ajuda*    - Ajuda');
  }

  if (t === 'carrinho' || t === 'ver_carrinho') {
    return client.sendMessage(num, await msgCarrinho(num));
  }

  if (t === 'ajuda') { return client.sendMessage(num, textoAjuda()); }

  if (t === 'finalizar') {
    const c = carrinhosCache[num];
    if (!c || !c.length) return client.sendMessage(num, 'Carrinho vazio!');
    const linhas = c.map(i => i.nome + ' x' + i.qtd + ' = ' + fmt(parseFloat(i.preco) * i.qtd)).join('\n');
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
    return client.sendMessage(num, '✅ *Pedido Confirmado!*\n\n' + linhas + '\n\n*Total:* ' + fmt(total) + '\n\nUm atendente entrará em contato para pagamento e entrega.');
  }

  if (t === 'limpar') { delete carrinhosCache[num]; return client.sendMessage(num, 'Carrinho limpo!'); }

  client.sendMessage(num, 'Nao entendi. Digite *menu* para comecar.');
});

client.initialize();
