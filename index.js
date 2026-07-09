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

function escMarkdown(s) {
  return String(s).replace(/([*_~`>#+\-=|{}.!])/g, '\\$1');
}

async function msgCarrinho(num) {
  const c = carrinhosCache[num] || [];
  if (!c.length) return '🛒 *Carrinho vazio!*\n\nUse *produtos* para ver o catalogo e *comprar <id> [qtd]* para adicionar itens.';
  let total = 0;
  const linhas = c.map((i, idx) => {
    total += parseFloat(i.preco) * i.qtd;
    return (idx + 1) + '. ' + escMarkdown(i.nome) + ' x' + i.qtd + ' = ' + fmt(parseFloat(i.preco) * i.qtd);
  }).join('\n');
  return '🛒 *Carrinho*\n\n' + linhas + '\n\n*Total:* ' + fmt(total) + '\n\nDigite *finalizar* para pedir ou *limpar* para limpar.';
}

function textoAjuda() {
  return (
    '❓ *Ajuda - Comandos*\n\n' +
    '*produtos* - Listar todos os produtos\n' +
    '*produtos <categoria>* - Filtrar por categoria\n' +
    '*detalhe <id>* - Ver detalhes de um produto\n' +
    '*comprar <id> [qtd]* - Adicionar ao carrinho (qtd opcional, padrao 1)\n' +
    '*carrinho* - Ver carrinho\n' +
    '*finalizar* - Finalizar pedido\n' +
    '*limpar* - Limpar carrinho\n' +
    '*menu* - Menu inicial\n' +
    '*ajuda* - Esta mensagem'
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

client.on('qr', async qr => {
  qrcode.generate(qr, { small: true });
  try {
    await fetch(API_BASE + '/api/qrcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Write-Key': API_WRITE_KEY },
      body: JSON.stringify({ qr, connected: false }),
    });
  } catch (e) {}
});

client.on('ready', async () => {
  console.log('Chatbot de e-commerce online!');
  try {
    await fetch(API_BASE + '/api/qrcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Write-Key': API_WRITE_KEY },
      body: JSON.stringify({ qr: null, connected: true }),
    });
  } catch (e) {}
});

client.on('disconnected', async () => {
  try {
    await fetch(API_BASE + '/api/qrcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Write-Key': API_WRITE_KEY },
      body: JSON.stringify({ qr: null, connected: false }),
    });
  } catch (e) {}
});

client.on('message', async msg => {
  const num = msg.from;
  if (!carrinhosCache[num]) carrinhosCache[num] = [];
  const t = msg.body.trim();
  const tl = t.toLowerCase();

  if (tl === 'menu' || tl === 'inicio' || tl === 'oi' || tl === 'ola') {
    return client.sendMessage(num,
      '🏪 *Catalogo de Produtos*\n\n' +
      'Bem-vindo! Aqui voce pode ver nossos produtos e pedir diretamente pelo WhatsApp.\n\n' +
      'Comandos:\n' +
      '*produtos* - Ver catalogo\n' +
      '*carrinho* - Ver carrinho\n' +
      '*finalizar* - Finalizar pedido\n' +
      '*ajuda* - Todos os comandos');
  }

  if (tl === 'carrinho' || tl === 'ver_carrinho') {
    return client.sendMessage(num, await msgCarrinho(num));
  }

  if (tl === 'ajuda') { return client.sendMessage(num, textoAjuda()); }

  if (tl === 'produtos' || tl.startsWith('produtos ')) {
    const categoria = tl.startsWith('produtos ') ? tl.slice(9).trim() : '';
    const params = categoria ? '?categoria=' + encodeURIComponent(categoria) : '?limit=20';
    try {
      const result = await api('GET', '/api/produtos' + params);
      const lista = result.data || [];
      if (!lista.length) return client.sendMessage(num, 'Nenhum produto encontrado' + (categoria ? ' na categoria "' + escMarkdown(categoria) + '"' : '') + '.');

      const linhas = lista.map(p =>
        '🆔 *' + p.id + '*\n' +
        escMarkdown(p.nome) + '\n' +
        fmt(parseFloat(p.preco)) + (p.estoque > 0 ? ' | Estoque: ' + p.estoque : ' | Indisponivel')
      ).join('\n\n');

      return client.sendMessage(num,
        '*📦 Produtos' + (categoria ? ' - ' + escMarkdown(categoria) : '') + '*\n\n' +
        linhas + '\n\n' +
        'Use *detalhe <id>* para ver mais ou *comprar <id> [qtd]* para adicionar ao carrinho.'
      );
    } catch (e) {
      return client.sendMessage(num, 'Erro ao buscar produtos.');
    }
  }

  if (tl.startsWith('detalhe ')) {
    const id = tl.slice(8).trim();
    if (!id) return client.sendMessage(num, 'Use: *detalhe <id>*');
    try {
      const result = await api('GET', '/api/produtos/' + encodeURIComponent(id));
      if (!result.success) return client.sendMessage(num, 'Produto nao encontrado.');
      const p = result.data;
      let msg = '*📄 ' + escMarkdown(p.nome) + '*\n\n';
      if (p.descricao) msg += escMarkdown(p.descricao) + '\n\n';
      msg += '*Preco:* ' + fmt(parseFloat(p.preco)) + '\n';
      msg += '*Categoria:* ' + escMarkdown(p.categoria) + '\n';
      msg += '*Estoque:* ' + (p.estoque > 0 ? p.estoque + ' unidades' : 'Indisponivel') + '\n';
      if (p.imagem) msg += '\n🔗 ' + p.imagem + '\n';
      msg += '\nPara comprar: *comprar ' + escMarkdown(p.id) + ' [qtd]*';
      return client.sendMessage(num, msg);
    } catch (e) {
      return client.sendMessage(num, 'Erro ao buscar detalhes do produto.');
    }
  }

  if (tl.startsWith('comprar ')) {
    const args = tl.slice(8).trim().split(/\s+/);
    const idProd = args[0];
    const qtd = parseInt(args[1]) || 1;
    if (!idProd) return client.sendMessage(num, 'Use: *comprar <id> [qtd]*');

    try {
      const result = await api('GET', '/api/produtos/' + encodeURIComponent(idProd));
      if (!result.success) return client.sendMessage(num, 'Produto nao encontrado. Use *produtos* para ver o catalogo.');
      const p = result.data;
      if (p.estoque < 1) return client.sendMessage(num, 'Produto indisponivel no momento.');

      const existente = carrinhosCache[num].find(i => i.id === p.id);
      if (existente) {
        existente.qtd += qtd;
      } else {
        carrinhosCache[num].push({
          id: p.id,
          nome: p.nome,
          preco: parseFloat(p.preco),
          qtd: qtd,
          imagem: p.imagem || '',
          categoria: p.categoria,
        });
      }
      return client.sendMessage(num,
        '✅ *' + escMarkdown(p.nome) + '* x' + qtd + ' adicionado ao carrinho!\n' +
        'Total no carrinho: ' + fmt(carrinhosCache[num].reduce((s, i) => s + i.preco * i.qtd, 0)) + '\n\n' +
        'Use *carrinho* para ver ou *finalizar* para pedir.'
      );
    } catch (e) {
      return client.sendMessage(num, 'Erro ao adicionar produto.');
    }
  }

  if (tl === 'finalizar') {
    const c = carrinhosCache[num];
    if (!c || !c.length) return client.sendMessage(num, 'Carrinho vazio! Adicione produtos com *comprar <id>*');
    const linhas = c.map(i => escMarkdown(i.nome) + ' x' + i.qtd + ' = ' + fmt(i.preco * i.qtd)).join('\n');
    const total = c.reduce((s, i) => s + i.preco * i.qtd, 0);

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
    return client.sendMessage(num, '✅ *Pedido Confirmado!*\n\n' + linhas + '\n\n*Total:* ' + fmt(total) + '\n\nUm atendente entrara em contato para pagamento e entrega.');
  }

  if (tl === 'limpar') { delete carrinhosCache[num]; return client.sendMessage(num, 'Carrinho limpo!'); }

  client.sendMessage(num, 'Nao entendi. Digite *menu* para comecar ou *ajuda* para ver os comandos.');
});

client.initialize();
