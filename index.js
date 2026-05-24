const { Client, LocalAuth, List, Buttons, Button, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const produtos = require('./data/produtos.json');
const categorias = ['eletronicos', 'moda', 'casa'];
const nomesCategoria = { eletronicos: '📱 Eletrônicos', moda: '👕 Moda', casa: '🏠 Casa' };

let carrinhos = {};
let ultimaCat = {}; // rastreia ultima categoria vista pelo usuario
try { carrinhos = require('./data/carrinhos.json'); } catch {}

function salvar() {
  fs.writeFileSync('./data/carrinhos.json', JSON.stringify(carrinhos, null, 2));
}

function fmt(v) { return `R$ ${v.toFixed(2).replace('.', ',')}`; }

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
    `*${prod.nome}*\n${prod.descricao}\n\n*Preço:* ${fmt(prod.preco)}\n*Estoque:* ${prod.estoque} un.`,
    [new Button('comprar_' + prod.id, '🛒 Comprar'), new Button('voltar', '⬅️ Voltar')],
    '🛍️ Produto',
    'O que deseja?'
  );
}

function msgCarrinho(num) {
  const c = carrinhos[num] || [];
  if (!c.length) return '🛒 *Carrinho vazio!*\nUse o menu para adicionar produtos.';
  let total = 0;
  const linhas = c.map((i, idx) => {
    total += i.preco * i.qtd;
    return `${idx + 1}. ${i.nome} x${i.qtd} = ${fmt(i.preco * i.qtd)}`;
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

function textoCategoria(cat) {
  const prods = produtos[cat];
  let t = `*${nomesCategoria[cat]}*\n\n`;
  prods.forEach((p, i) => { t += `${i + 1}. *${p.nome}* - ${fmt(p.preco)}\n   ${p.descricao}\n\n`; });
  t += 'Digite o *número* do produto para ver detalhes.';
  return t;
}

function listaProdutos(cat) {
  return new List(
    textoCategoria(cat),
    '📱 Ver produtos',
    [{
      title: nomesCategoria[cat],
      rows: produtos[cat].map(p => ({
        id: `prod_${cat}_${p.id}`,
        title: p.nome,
        description: `${fmt(p.preco)} - Estoque: ${p.estoque}`,
      })),
    }],
    'Selecione:'
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
  if (!carrinhos[num]) carrinhos[num] = [];

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
    return client.sendMessage(num, menuCategorias());
  }

  if (t === 'ver_carrinho' || t === 'carrinho') {
    return client.sendMessage(num, msgCarrinho(num));
  }

  if (t === 'ajuda') { return client.sendMessage(num, textoAjuda()); }

  if (t === 'finalizar') {
    const c = carrinhos[num];
    if (!c || !c.length) return client.sendMessage(num, 'Carrinho vazio!');
    const linhas = c.map(i => `${i.nome} x${i.qtd} = ${fmt(i.preco * i.qtd)}`).join('\n');
    const total = c.reduce((s, i) => s + i.preco * i.qtd, 0);
    delete carrinhos[num]; delete ultimaCat[num]; salvar();
    return client.sendMessage(num, `✅ *Pedido Confirmado!*\n\n${linhas}\n\n*Total:* ${fmt(total)}\n\nUm atendente entrará em contato para pagamento e entrega. 🚚`);
  }

  if (t === 'limpar') { delete carrinhos[num]; delete ultimaCat[num]; salvar(); return client.sendMessage(num, '🗑️ Carrinho limpo!'); }

  if (t === 'voltar') { return client.sendMessage(num, menuCategorias()); }

  if (t.startsWith('cat_')) {
    const cat = t.slice(4);
    if (!produtos[cat]) return;
    ultimaCat[num] = cat;
    return client.sendMessage(num, listaProdutos(cat));
  }

  if (t.startsWith('prod_')) {
    const partes = t.split('_');
    const cat = partes[1];
    const prodId = partes.slice(2).join('_');
    const prod = produtos[cat]?.find(p => p.id === prodId);
    if (!prod) return;
    try {
      const media = await MessageMedia.fromUrl(prod.imagem, { unsafeMime: true });
      await client.sendMessage(num, media, { caption: `*${prod.nome}*\n${fmt(prod.preco)}` });
    } catch {}
    return client.sendMessage(num, botoesProduto(prod));
  }

  if (t.startsWith('comprar_')) {
    const prodId = t.slice(8);
    for (const cat of categorias) {
      const prod = produtos[cat]?.find(p => p.id === prodId);
      if (prod) {
        const existente = carrinhos[num].find(i => i.id === prodId);
        if (existente) { existente.qtd++; }
        else { carrinhos[num].push({ id: prodId, nome: prod.nome, preco: prod.preco, qtd: 1 }); }
        salvar();
        return client.sendMessage(num,
          `✅ *${prod.nome}* adicionado ao carrinho!\n\nDigite *carrinho* para ver ou *menu* para continuar.`);
      }
    }
    return client.sendMessage(num, 'Produto não encontrado.');
  }

  // Selecao por numero - usa ultima categoria visitada
  const idx = parseInt(t, 10);
  if (!isNaN(idx) && idx >= 1 && ultimaCat[num]) {
    const prods = produtos[ultimaCat[num]];
    if (idx <= prods.length) {
      const prod = prods[idx - 1];
      try {
        const media = await MessageMedia.fromUrl(prod.imagem, { unsafeMime: true });
        await client.sendMessage(num, media, { caption: `*${prod.nome}*\n${fmt(prod.preco)}` });
      } catch {}
      return client.sendMessage(num, botoesProduto(prod));
    }
    return client.sendMessage(num, 'Número inválido. Digite *menu*.');
  }

  // fallback se nao tem ultimaCat mas digitou numero
  if (!isNaN(idx) && idx >= 1) {
    for (const cat of categorias) {
      const prods = produtos[cat];
      if (idx <= prods.length) {
        const prod = prods[idx - 1];
        try {
          const media = await MessageMedia.fromUrl(prod.imagem, { unsafeMime: true });
          await client.sendMessage(num, media, { caption: `*${prod.nome}*\n${fmt(prod.preco)}` });
        } catch {}
        return client.sendMessage(num, botoesProduto(prod));
      }
    }
    return client.sendMessage(num, 'Número inválido. Digite *menu*.');
  }

  client.sendMessage(num, 'Não entendi. Digite *menu* para começar.');
});

client.initialize();
