const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || 'ecommerce-api-token';
const API_WRITE_KEY = process.env.API_WRITE_KEY || API_TOKEN;

let carrinhosCache = {};
const userSession = {};

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

function esc(s) { return String(s).replace(/([*_~`>#+\-=|{}.!])/g, '\\$1'); }

function menuPrincipal(nome) {
  const saudacao = nome ? 'Ola, ' + esc(nome) + '!' : 'Bem-vindo!';
  return (
    '🏪 *Menu Principal*\n' + saudacao + '\n\n' +
    '1. 📦 Ver Produtos\n' +
    '2. 🛒 Meu Carrinho\n' +
    '3. 👤 Meu Cadastro\n' +
    '4. ✅ Finalizar Pedido\n' +
    '5. 🗑️ Limpar Carrinho\n' +
    '6. ❓ Ajuda\n\n' +
    'Digite o numero da opcao desejada.'
  );
}

async function menuCategorias(num) {
  try {
    const resp = await fetch(API_BASE + '/data/produtos');
    const produtos = await resp.json();
    const cats = {};
    produtos.forEach(p => { if (p.categoria) cats[p.categoria] = true; });
    const lista = Object.keys(cats).sort();
    let msg = '📦 *Categorias*\n\n';
    lista.forEach((c, i) => { msg += (i + 1) + '. ' + c.charAt(0).toUpperCase() + c.slice(1) + '\n'; });
    msg += '\n0. 🔙 Voltar\n\nDigite o numero da categoria.';
    userSession[num] = { menu: 'categorias', cats: lista };
    return msg;
  } catch (e) {
    return 'Erro ao carregar categorias.';
  }
}

async function listarProdutos(num, categoria, pagina = 0) {
  const params = categoria ? '?categoria=' + encodeURIComponent(categoria) + '&limit=10&offset=' + (pagina * 10) : '?limit=10&offset=' + (pagina * 10);
  try {
    const result = await api('GET', '/api/produtos' + params);
    const lista = result.data || [];
    if (!lista.length) return 'Nenhum produto encontrado' + (categoria ? ' em ' + esc(categoria) : '') + '.';

    let msg = '*📦 Produtos' + (categoria ? ' - ' + esc(categoria) : '') + '*\n\n';
    lista.forEach((p, i) => {
      msg += (pagina * 10 + i + 1) + '. *' + esc(p.nome) + '*\n';
      msg += '   ID: ' + p.id + ' | ' + fmt(parseFloat(p.preco));
      if (p.estoque > 0) msg += ' | Estq: ' + p.estoque;
      msg += '\n\n';
    });
    msg += 'Para comprar: *comprar <id> [qtd]*\n';
    msg += 'Para detalhes: *detalhe <id>*\n';
    if (lista.length === 10) msg += '\nProxima pagina: *mais*';
    msg += '\n\n0. 🔙 Voltar';
    return msg;
  } catch (e) {
    return 'Erro ao buscar produtos.';
  }
}

async function msgCarrinho(num) {
  const c = carrinhosCache[num] || [];
  if (!c.length) return '🛒 *Carrinho vazio!*\n\nAdicione produtos com *comprar <id>* ou pelo site.\n\n0. 🔙 Voltar';
  let total = 0;
  const linhas = c.map((i, idx) => {
    total += i.preco * i.qtd;
    return (idx + 1) + '. ' + esc(i.nome) + ' x' + i.qtd + ' = ' + fmt(i.preco * i.qtd);
  }).join('\n');
  return '🛒 *Carrinho*\n\n' + linhas + '\n\n*Total:* ' + fmt(total) + '\n\n4. ✅ Finalizar\n5. 🗑️ Limpar\n\n0. 🔙 Voltar';
}

async function verCadastro(num) {
  try {
    const result = await api('GET', '/api/clientes/' + encodeURIComponent(num));
    if (!result.success) return null;
    return result.data;
  } catch (e) {
    return null;
  }
}

function formatCadastro(cliente) {
  return (
    '👤 *Meu Cadastro*\n\n' +
    '*Nome:* ' + esc(cliente.nome) + '\n' +
    '*Telefone:* ' + esc(cliente.telefone) + '\n' +
    (cliente.endereco ? '*Endereco:* ' + esc(cliente.endereco) + '\n' : '') +
    (cliente.cidade ? '*Cidade:* ' + esc(cliente.cidade) + '\n' : '') +
    '\n1. ✏️ Editar nome\n' +
    '2. ✏️ Editar endereco\n' +
    '3. ✏️ Editar cidade\n' +
    '4. ❌ Excluir cadastro\n' +
    '0. 🔙 Voltar'
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

  // --- MENU / INICIO ---
  if (tl === 'menu' || tl === 'inicio' || tl === 'oi' || tl === 'ola' || tl === '0' || tl === 'voltar') {
    delete userSession[num];
    const cliente = await verCadastro(num);
    return client.sendMessage(num, menuPrincipal(cliente ? cliente.nome : null));
  }

  // --- AJUDA ---
  if (tl === 'ajuda' || tl === '6') {
    return client.sendMessage(num,
      '❓ *Ajuda - Comandos*\n\n' +
      'Menu numerado:\n' +
      '1 - Ver produtos por categoria\n' +
      '2 - Ver carrinho\n' +
      '3 - Meu cadastro (nome, endereco)\n' +
      '4 - Finalizar pedido\n' +
      '5 - Limpar carrinho\n' +
      '6 - Ajuda\n' +
      '0 - Voltar ao menu\n\n' +
      'Comandos diretos:\n' +
      '*produtos* - Listar catalogo\n' +
      '*comprar <id> [qtd]* - Adicionar ao carrinho\n' +
      '*detalhe <id>* - Detalhes do produto\n' +
      '*carrinho* - Ver carrinho\n' +
      '*finalizar* - Confirmar pedido\n' +
      '*cadastro* - Meu cadastro\n' +
      '*menu* - Menu principal'
    );
  }

  // --- PRODUTOS (1) ---
  if (tl === 'produtos' || tl === '1') {
    return client.sendMessage(num, await menuCategorias(num));
  }

  if (tl.startsWith('produtos ')) {
    const categoria = tl.slice(9).trim();
    userSession[num] = { menu: 'produtos', categoria };
    return client.sendMessage(num, await listarProdutos(num, categoria));
  }

  // --- MAIS (pagina seguinte) ---
  if (tl === 'mais') {
    const sess = userSession[num];
    if (!sess || sess.menu !== 'produtos') return client.sendMessage(num, 'Use *produtos* primeiro.');
    const pag = (sess.pagina || 0) + 1;
    sess.pagina = pag;
    return client.sendMessage(num, await listarProdutos(num, sess.categoria, pag));
  }

  // --- DETALHE ---
  if (tl.startsWith('detalhe ')) {
    const id = tl.slice(8).trim();
    if (!id) return client.sendMessage(num, 'Use: *detalhe <id>*');
    try {
      const result = await api('GET', '/api/produtos/' + encodeURIComponent(id));
      if (!result.success) return client.sendMessage(num, 'Produto nao encontrado.');
      const p = result.data;
      let m = '*📄 ' + esc(p.nome) + '*\n\n';
      if (p.descricao) m += esc(p.descricao) + '\n\n';
      m += '*Preco:* ' + fmt(parseFloat(p.preco)) + '\n';
      m += '*Categoria:* ' + esc(p.categoria) + '\n';
      m += '*Estoque:* ' + (p.estoque > 0 ? p.estoque + ' unidades' : 'Indisponivel') + '\n';
      if (p.imagem) m += '\n🔗 ' + p.imagem + '\n';
      m += '\nPara comprar: *comprar ' + esc(p.id) + ' [qtd]*';
      return client.sendMessage(num, m);
    } catch (e) {
      return client.sendMessage(num, 'Erro ao buscar detalhes.');
    }
  }

  // --- COMPRAR ---
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
        '✅ *' + esc(p.nome) + '* x' + qtd + ' adicionado ao carrinho!\n' +
        'Total: ' + fmt(carrinhosCache[num].reduce((s, i) => s + i.preco * i.qtd, 0)) + '\n\n' +
        '1. 📦 Ver mais produtos\n' +
        '2. 🛒 Ver carrinho\n' +
        '0. 🔙 Menu principal'
      );
    } catch (e) {
      return client.sendMessage(num, 'Erro ao adicionar produto.');
    }
  }

  // --- CARRINHO (2) ---
  if (tl === 'carrinho' || tl === 'ver_carrinho' || tl === '2') {
    return client.sendMessage(num, await msgCarrinho(num));
  }

  // --- CADASTRO (3) ---
  if (tl === 'cadastro' || tl === '3') {
    const cliente = await verCadastro(num);
    if (cliente) {
      return client.sendMessage(num, formatCadastro(cliente));
    }
    const sess = userSession[num];
    if (sess && sess.menu === 'cadastro_aguardando_nome') {
      return client.sendMessage(num, 'Por favor, digite seu *nome* primeiro.');
    }
    userSession[num] = { menu: 'cadastro_aguardando_nome' };
    return client.sendMessage(num,
      '👤 *Novo Cadastro*\n\n' +
      'Vamos criar seu cadastro! Primeiro, digite seu *nome completo*:' +
      '\n\n0. 🔙 Cancelar'
    );
  }

  // Fluxo de cadastro - aguardando nome
  if (userSession[num] && userSession[num].menu === 'cadastro_aguardando_nome') {
    if (t.length < 3) return client.sendMessage(num, 'Nome invalido. Digite seu nome completo ou 0 para cancelar.');
    userSession[num] = { menu: 'cadastro_aguardando_endereco', nome: t };
    return client.sendMessage(num,
      'Obrigado, ' + esc(t) + '! Agora digite seu *endereco* (rua, numero, bairro):' +
      '\n\n0. 🔙 Cancelar'
    );
  }

  // Fluxo de cadastro - aguardando endereco
  if (userSession[num] && userSession[num].menu === 'cadastro_aguardando_endereco') {
    if (t.length < 5) return client.sendMessage(num, 'Endereco invalido. Digite seu endereco ou 0 para cancelar.');
    userSession[num] = { menu: 'cadastro_aguardando_cidade', nome: userSession[num].nome, endereco: t };
    return client.sendMessage(num,
      'Agora digite sua *cidade*:' +
      '\n\n0. 🔙 Cancelar'
    );
  }

  // Fluxo de cadastro - aguardando cidade
  if (userSession[num] && userSession[num].menu === 'cadastro_aguardando_cidade') {
    if (t.length < 2) return client.sendMessage(num, 'Cidade invalida. Digite sua cidade ou 0 para cancelar.');
    const dados = userSession[num];
    const telefone = num.replace('@c.us', '');

    try {
      const result = await api('POST', '/api/clientes', {
        id: num,
        nome: dados.nome,
        telefone: telefone,
        endereco: dados.endereco,
        cidade: t,
      });

      if (result.success) {
        delete userSession[num];
        return client.sendMessage(num,
          '✅ *Cadastro realizado com sucesso!*\n\n' +
          '*Nome:* ' + esc(dados.nome) + '\n' +
          '*Endereco:* ' + esc(dados.endereco) + '\n' +
          '*Cidade:* ' + esc(t) + '\n\n' +
          '1. 📦 Ver produtos\n' +
          '0. 🔙 Menu principal'
        );
      } else {
        return client.sendMessage(num, 'Erro ao salvar cadastro. Tente novamente.');
      }
    } catch (e) {
      return client.sendMessage(num, 'Erro ao salvar cadastro. Tente novamente.');
    }
  }

  // Edicao de cadastro
  if (userSession[num] && userSession[num].menu === 'editando_nome') {
    if (t.length < 3) return client.sendMessage(num, 'Nome invalido.');
    try {
      await api('PUT', '/api/clientes/' + encodeURIComponent(num), { nome: t });
      delete userSession[num];
      return client.sendMessage(num, '✅ Nome atualizado!\n\n0. 🔙 Voltar');
    } catch (e) {
      return client.sendMessage(num, 'Erro ao atualizar.');
    }
  }

  if (userSession[num] && userSession[num].menu === 'editando_endereco') {
    if (t.length < 5) return client.sendMessage(num, 'Endereco invalido.');
    try {
      await api('PUT', '/api/clientes/' + encodeURIComponent(num), { endereco: t });
      delete userSession[num];
      return client.sendMessage(num, '✅ Endereco atualizado!\n\n0. 🔙 Voltar');
    } catch (e) {
      return client.sendMessage(num, 'Erro ao atualizar.');
    }
  }

  if (userSession[num] && userSession[num].menu === 'editando_cidade') {
    if (t.length < 2) return client.sendMessage(num, 'Cidade invalida.');
    try {
      await api('PUT', '/api/clientes/' + encodeURIComponent(num), { cidade: t });
      delete userSession[num];
      return client.sendMessage(num, '✅ Cidade atualizada!\n\n0. 🔙 Voltar');
    } catch (e) {
      return client.sendMessage(num, 'Erro ao atualizar.');
    }
  }

  if (userSession[num] && userSession[num].menu === 'confirmar_exclusao') {
    if (tl === 'sim') {
      try {
        await api('DELETE', '/api/clientes/' + encodeURIComponent(num));
        delete userSession[num];
        return client.sendMessage(num, '✅ Cadastro excluido.\n\n0. 🔙 Menu principal');
      } catch (e) {
        return client.sendMessage(num, 'Erro ao excluir cadastro.');
      }
    } else {
      delete userSession[num];
      return client.sendMessage(num, 'Exclusao cancelada.\n\n0. 🔙 Voltar');
    }
  }

  // --- FINALIZAR (4) ---
  if (tl === 'finalizar' || tl === '4') {
    const c = carrinhosCache[num];
    if (!c || !c.length) return client.sendMessage(num, 'Carrinho vazio! Adicione produtos com *comprar <id>*');
    const linhas = c.map(i => esc(i.nome) + ' x' + i.qtd + ' = ' + fmt(i.preco * i.qtd)).join('\n');
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
    return client.sendMessage(num,
      '✅ *Pedido Confirmado!*\n\n' + linhas + '\n\n*Total:* ' + fmt(total) +
      '\n\nUm atendente entrara em contato para pagamento e entrega.\n\n' +
      '0. 🔙 Menu principal'
    );
  }

  // --- LIMPAR (5) ---
  if (tl === 'limpar' || tl === '5') {
    delete carrinhosCache[num];
    return client.sendMessage(num, 'Carrinho limpo!\n\n0. 🔙 Menu principal');
  }

  // --- MENU CATEGORIAS (numeros) ---
  if (userSession[num] && userSession[num].menu === 'categorias') {
    const idx = parseInt(t) - 1;
    const cat = userSession[num].cats[idx];
    if (cat) {
      userSession[num] = { menu: 'produtos', categoria: cat, pagina: 0 };
      return client.sendMessage(num, await listarProdutos(num, cat));
    }
  }

  // --- EDIÇÃO / EXCLUSÃO DE CADASTRO ---
  if (userSession[num] && userSession[num].menu === 'visualizando_cadastro') {
    if (tl === '1') {
      userSession[num] = { menu: 'editando_nome' };
      return client.sendMessage(num, 'Digite o novo *nome*:' + '\n\n0. 🔙 Cancelar');
    }
    if (tl === '2') {
      userSession[num] = { menu: 'editando_endereco' };
      return client.sendMessage(num, 'Digite o novo *endereco*:' + '\n\n0. 🔙 Cancelar');
    }
    if (tl === '3') {
      userSession[num] = { menu: 'editando_cidade' };
      return client.sendMessage(num, 'Digite a nova *cidade*:' + '\n\n0. 🔙 Cancelar');
    }
    if (tl === '4') {
      userSession[num] = { menu: 'confirmar_exclusao' };
      return client.sendMessage(num, 'Tem certeza que deseja excluir seu cadastro? Digite *sim* ou *nao*.');
    }
  }

  // fallback
  client.sendMessage(num, 'Nao entendi. Digite *menu* para comecar.');
});

client.initialize();
