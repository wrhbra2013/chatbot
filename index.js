import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

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
    '\u{1F3EA} *Menu Principal*\n' + saudacao + '\n\n' +
    '1. \u{1F4E6} Ver Produtos\n' +
    '2. \u{1F6D2} Meu Carrinho\n' +
    '3. \u{1F464} Meu Cadastro\n' +
    '4. \u2705 Finalizar Pedido\n' +
    '5. \u{1F5D1}\uFE0F Limpar Carrinho\n' +
    '6. \u2753 Ajuda\n\n' +
    'Digite o numero da opcao desejada.'
  );
}

async function menuCategorias(jid) {
  try {
    const resp = await fetch(API_BASE + '/data/produtos');
    const produtos = await resp.json();
    const cats = {};
    produtos.forEach(p => { if (p.categoria) cats[p.categoria] = true; });
    const lista = Object.keys(cats).sort();
    let msg = '\u{1F4E6} *Categorias*\n\n';
    lista.forEach((c, i) => { msg += (i + 1) + '. ' + c.charAt(0).toUpperCase() + c.slice(1) + '\n'; });
    msg += '\n0. \u{1F519} Voltar\n\nDigite o numero da categoria.';
    userSession[jid] = { menu: 'categorias', cats: lista };
    return msg;
  } catch (e) {
    return 'Erro ao carregar categorias.';
  }
}

async function listarProdutos(jid, categoria, pagina = 0) {
  const params = categoria ? '?categoria=' + encodeURIComponent(categoria) + '&limit=10&offset=' + (pagina * 10) : '?limit=10&offset=' + (pagina * 10);
  try {
    const result = await api('GET', '/api/produtos' + params);
    const lista = result.data || [];
    if (!lista.length) return 'Nenhum produto encontrado' + (categoria ? ' em ' + esc(categoria) : '') + '.';

    let msg = '*\u{1F4E6} Produtos' + (categoria ? ' - ' + esc(categoria) : '') + '*\n\n';
    lista.forEach((p, i) => {
      msg += (pagina * 10 + i + 1) + '. *' + esc(p.nome) + '*\n';
      msg += '   ID: ' + p.id + ' | ' + fmt(parseFloat(p.preco));
      if (p.estoque > 0) msg += ' | Estq: ' + p.estoque;
      msg += '\n\n';
    });
    msg += 'Para comprar: *comprar <id> [qtd]*\n';
    msg += 'Para detalhes: *detalhe <id>*\n';
    if (lista.length === 10) msg += '\nProxima pagina: *mais*';
    msg += '\n\n0. \u{1F519} Voltar';
    return msg;
  } catch (e) {
    return 'Erro ao buscar produtos.';
  }
}

async function msgCarrinho(jid) {
  const c = carrinhosCache[jid] || [];
  if (!c.length) return '\u{1F6D2} *Carrinho vazio!*\n\nAdicione produtos com *comprar <id>* ou pelo site.\n\n0. \u{1F519} Voltar';
  let total = c.reduce((s, i) => s + parseFloat(i.preco) * i.qtd, 0);
  const linhas = c.map((i, idx) => (idx + 1) + '. ' + esc(i.nome) + ' x' + i.qtd + ' = ' + fmt(parseFloat(i.preco) * i.qtd)).join('\n');
  return '\u{1F6D2} *Carrinho*\n\n' + linhas + '\n\n*Total:* ' + fmt(total) + '\n\n4. \u2705 Finalizar\n5. \u{1F5D1}\uFE0F Limpar\n\n0. \u{1F519} Voltar';
}

async function verCadastro(jid) {
  try {
    const result = await api('GET', '/api/clientes/' + encodeURIComponent(jid));
    if (!result.success) return null;
    return result.data;
  } catch (e) {
    return null;
  }
}

function formatCadastro(cliente) {
  return (
    '\u{1F464} *Meu Cadastro*\n\n' +
    '*Nome:* ' + esc(cliente.nome) + '\n' +
    '*Telefone:* ' + esc(cliente.telefone) + '\n' +
    (cliente.endereco ? '*Endereco:* ' + esc(cliente.endereco) + '\n' : '') +
    (cliente.cidade ? '*Cidade:* ' + esc(cliente.cidade) + '\n' : '') +
    '\n1. \u270F\uFE0F Editar nome\n' +
    '2. \u270F\uFE0F Editar endereco\n' +
    '3. \u270F\uFE0F Editar cidade\n' +
    '4. \u274C Excluir cadastro\n' +
    '0. \u{1F519} Voltar'
  );
}

async function enviar(sock, jid, texto) {
  await sock.sendMessage(jid, { text: texto });
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    syncFullHistory: false,
    browser: ['Ecommerce Bot', 'Chrome', '1.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      try {
        await fetch(API_BASE + '/api/qrcode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Write-Key': API_WRITE_KEY },
          body: JSON.stringify({ qr, connected: false }),
        });
      } catch (e) {}
    }
    if (connection === 'open') {
      console.log('Chatbot de e-commerce online (Baileys)!');
      try {
        await fetch(API_BASE + '/api/qrcode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Write-Key': API_WRITE_KEY },
          body: JSON.stringify({ qr: null, connected: true }),
        });
      } catch (e) {}
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexao fechada, reconectando:', shouldReconnect);
      try {
        await fetch(API_BASE + '/api/qrcode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Write-Key': API_WRITE_KEY },
          body: JSON.stringify({ qr: null, connected: false }),
        });
      } catch (e) {}
      if (shouldReconnect) startBot();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;

      const jid = msg.key.remoteJid;
      if (jid.includes('@g.us')) continue;

      if (!carrinhosCache[jid]) carrinhosCache[jid] = [];

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      const t = text.trim();
      const tl = t.toLowerCase();

      // --- MENU / INICIO ---
      if (tl === 'menu' || tl === 'inicio' || tl === 'oi' || tl === 'ola' || tl === '0' || tl === 'voltar') {
        delete userSession[jid];
        const cliente = await verCadastro(jid);
        return enviar(sock, jid, menuPrincipal(cliente ? cliente.nome : null));
      }

      // --- AJUDA ---
      if (tl === 'ajuda' || tl === '6') {
        return enviar(sock, jid,
          '\u2753 *Ajuda - Comandos*\n\n' +
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
        return enviar(sock, jid, await menuCategorias(jid));
      }

      if (tl.startsWith('produtos ')) {
        const categoria = tl.slice(9).trim();
        userSession[jid] = { menu: 'produtos', categoria };
        return enviar(sock, jid, await listarProdutos(jid, categoria));
      }

      // --- MAIS (pagina seguinte) ---
      if (tl === 'mais') {
        const sess = userSession[jid];
        if (!sess || sess.menu !== 'produtos') return enviar(sock, jid, 'Use *produtos* primeiro.');
        const pag = (sess.pagina || 0) + 1;
        sess.pagina = pag;
        return enviar(sock, jid, await listarProdutos(jid, sess.categoria, pag));
      }

      // --- DETALHE ---
      if (tl.startsWith('detalhe ')) {
        const id = tl.slice(8).trim();
        if (!id) return enviar(sock, jid, 'Use: *detalhe <id>*');
        try {
          const result = await api('GET', '/api/produtos/' + encodeURIComponent(id));
          if (!result.success) return enviar(sock, jid, 'Produto nao encontrado.');
          const p = result.data;
          let m = '*\u{1F4C4} ' + esc(p.nome) + '*\n\n';
          if (p.descricao) m += esc(p.descricao) + '\n\n';
          m += '*Preco:* ' + fmt(parseFloat(p.preco)) + '\n';
          m += '*Categoria:* ' + esc(p.categoria) + '\n';
          m += '*Estoque:* ' + (p.estoque > 0 ? p.estoque + ' unidades' : 'Indisponivel') + '\n';
          if (p.imagem) m += '\n\u{1F517} ' + p.imagem + '\n';
          m += '\nPara comprar: *comprar ' + esc(p.id) + ' [qtd]*';
          return enviar(sock, jid, m);
        } catch (e) {
          return enviar(sock, jid, 'Erro ao buscar detalhes.');
        }
      }

      // --- COMPRAR ---
      if (tl.startsWith('comprar ')) {
        const args = tl.slice(8).trim().split(/\s+/);
        const idProd = args[0];
        const qtd = parseInt(args[1]) || 1;
        if (!idProd) return enviar(sock, jid, 'Use: *comprar <id> [qtd]*');

        try {
          const result = await api('GET', '/api/produtos/' + encodeURIComponent(idProd));
          if (!result.success) return enviar(sock, jid, 'Produto nao encontrado. Use *produtos* para ver o catalogo.');
          const p = result.data;
          if (p.estoque < 1) return enviar(sock, jid, 'Produto indisponivel no momento.');

          const existente = carrinhosCache[jid].find(i => i.id === p.id);
          if (existente) {
            existente.qtd += qtd;
          } else {
            carrinhosCache[jid].push({
              id: p.id,
              nome: p.nome,
              preco: parseFloat(p.preco),
              qtd: qtd,
              imagem: p.imagem || '',
              categoria: p.categoria,
            });
          }
          const total = carrinhosCache[jid].reduce((s, i) => s + parseFloat(i.preco) * i.qtd, 0);
          return enviar(sock, jid,
            '\u2705 *' + esc(p.nome) + '* x' + qtd + ' adicionado ao carrinho!\n' +
            'Total: ' + fmt(total) + '\n\n' +
            '1. \u{1F4E6} Ver mais produtos\n' +
            '2. \u{1F6D2} Ver carrinho\n' +
            '0. \u{1F519} Menu principal'
          );
        } catch (e) {
          return enviar(sock, jid, 'Erro ao adicionar produto.');
        }
      }

      // --- CARRINHO (2) ---
      if (tl === 'carrinho' || tl === 'ver_carrinho' || tl === '2') {
        return enviar(sock, jid, await msgCarrinho(jid));
      }

      // --- CADASTRO (3) ---
      if (tl === 'cadastro' || tl === '3') {
        const cliente = await verCadastro(jid);
        if (cliente) {
          return enviar(sock, jid, formatCadastro(cliente));
        }
        const sess = userSession[jid];
        if (sess && sess.menu === 'cadastro_aguardando_nome') {
          return enviar(sock, jid, 'Por favor, digite seu *nome* primeiro.');
        }
        userSession[jid] = { menu: 'cadastro_aguardando_nome' };
        return enviar(sock, jid,
          '\u{1F464} *Novo Cadastro*\n\n' +
          'Vamos criar seu cadastro! Primeiro, digite seu *nome completo*:' +
          '\n\n0. \u{1F519} Cancelar'
        );
      }

      // Fluxo de cadastro - aguardando nome
      if (userSession[jid] && userSession[jid].menu === 'cadastro_aguardando_nome') {
        if (t.length < 3) return enviar(sock, jid, 'Nome invalido. Digite seu nome completo ou 0 para cancelar.');
        userSession[jid] = { menu: 'cadastro_aguardando_endereco', nome: t };
        return enviar(sock, jid,
          'Obrigado, ' + esc(t) + '! Agora digite seu *endereco* (rua, numero, bairro):' +
          '\n\n0. \u{1F519} Cancelar'
        );
      }

      // Fluxo de cadastro - aguardando endereco
      if (userSession[jid] && userSession[jid].menu === 'cadastro_aguardando_endereco') {
        if (t.length < 5) return enviar(sock, jid, 'Endereco invalido. Digite seu endereco ou 0 para cancelar.');
        userSession[jid] = { menu: 'cadastro_aguardando_cidade', nome: userSession[jid].nome, endereco: t };
        return enviar(sock, jid,
          'Agora digite sua *cidade*:' +
          '\n\n0. \u{1F519} Cancelar'
        );
      }

      // Fluxo de cadastro - aguardando cidade
      if (userSession[jid] && userSession[jid].menu === 'cadastro_aguardando_cidade') {
        if (t.length < 2) return enviar(sock, jid, 'Cidade invalida. Digite sua cidade ou 0 para cancelar.');
        const dados = userSession[jid];
        const telefone = jid.split('@')[0];

        try {
          const result = await api('POST', '/api/clientes', {
            id: jid,
            nome: dados.nome,
            telefone: telefone,
            endereco: dados.endereco,
            cidade: t,
          });

          if (result.success) {
            delete userSession[jid];
            return enviar(sock, jid,
              '\u2705 *Cadastro realizado com sucesso!*\n\n' +
              '*Nome:* ' + esc(dados.nome) + '\n' +
              '*Endereco:* ' + esc(dados.endereco) + '\n' +
              '*Cidade:* ' + esc(t) + '\n\n' +
              '1. \u{1F4E6} Ver produtos\n' +
              '0. \u{1F519} Menu principal'
            );
          } else {
            return enviar(sock, jid, 'Erro ao salvar cadastro. Tente novamente.');
          }
        } catch (e) {
          return enviar(sock, jid, 'Erro ao salvar cadastro. Tente novamente.');
        }
      }

      // Edicao de cadastro
      if (userSession[jid] && userSession[jid].menu === 'editando_nome') {
        if (t.length < 3) return enviar(sock, jid, 'Nome invalido.');
        try {
          await api('PUT', '/api/clientes/' + encodeURIComponent(jid), { nome: t });
          delete userSession[jid];
          return enviar(sock, jid, '\u2705 Nome atualizado!\n\n0. \u{1F519} Voltar');
        } catch (e) {
          return enviar(sock, jid, 'Erro ao atualizar.');
        }
      }

      if (userSession[jid] && userSession[jid].menu === 'editando_endereco') {
        if (t.length < 5) return enviar(sock, jid, 'Endereco invalido.');
        try {
          await api('PUT', '/api/clientes/' + encodeURIComponent(jid), { endereco: t });
          delete userSession[jid];
          return enviar(sock, jid, '\u2705 Endereco atualizado!\n\n0. \u{1F519} Voltar');
        } catch (e) {
          return enviar(sock, jid, 'Erro ao atualizar.');
        }
      }

      if (userSession[jid] && userSession[jid].menu === 'editando_cidade') {
        if (t.length < 2) return enviar(sock, jid, 'Cidade invalida.');
        try {
          await api('PUT', '/api/clientes/' + encodeURIComponent(jid), { cidade: t });
          delete userSession[jid];
          return enviar(sock, jid, '\u2705 Cidade atualizada!\n\n0. \u{1F519} Voltar');
        } catch (e) {
          return enviar(sock, jid, 'Erro ao atualizar.');
        }
      }

      if (userSession[jid] && userSession[jid].menu === 'confirmar_exclusao') {
        if (tl === 'sim') {
          try {
            await api('DELETE', '/api/clientes/' + encodeURIComponent(jid));
            delete userSession[jid];
            return enviar(sock, jid, '\u2705 Cadastro excluido.\n\n0. \u{1F519} Menu principal');
          } catch (e) {
            return enviar(sock, jid, 'Erro ao excluir cadastro.');
          }
        } else {
          delete userSession[jid];
          return enviar(sock, jid, 'Exclusao cancelada.\n\n0. \u{1F519} Voltar');
        }
      }

      // --- FINALIZAR (4) ---
      if (tl === 'finalizar' || tl === '4') {
        const c = carrinhosCache[jid];
        if (!c || !c.length) return enviar(sock, jid, 'Carrinho vazio! Adicione produtos com *comprar <id>*');
        const linhas = c.map(i => esc(i.nome) + ' x' + i.qtd + ' = ' + fmt(parseFloat(i.preco) * i.qtd)).join('\n');
        const total = c.reduce((s, i) => s + parseFloat(i.preco) * i.qtd, 0);

        try {
          await api('POST', '/api/create', {
            table: 'pedidos',
            data: {
              cliente_id: jid,
              cliente_nome: 'Cliente WhatsApp',
              cliente_telefone: jid.split('@')[0],
              itens: JSON.stringify(c),
              total,
              status: 'pendente',
              forma_pagamento: 'whatsapp',
            },
          });
        } catch (e) {
          console.error('Erro ao salvar pedido:', e.message);
        }

        delete carrinhosCache[jid];
        return enviar(sock, jid,
          '\u2705 *Pedido Confirmado!*\n\n' + linhas + '\n\n*Total:* ' + fmt(total) +
          '\n\nUm atendente entrara em contato para pagamento e entrega.\n\n' +
          '0. \u{1F519} Menu principal'
        );
      }

      // --- LIMPAR (5) ---
      if (tl === 'limpar' || tl === '5') {
        delete carrinhosCache[jid];
        return enviar(sock, jid, 'Carrinho limpo!\n\n0. \u{1F519} Menu principal');
      }

      // --- MENU CATEGORIAS (numeros) ---
      if (userSession[jid] && userSession[jid].menu === 'categorias') {
        const idx = parseInt(t) - 1;
        const cat = userSession[jid].cats[idx];
        if (cat) {
          userSession[jid] = { menu: 'produtos', categoria: cat, pagina: 0 };
          return enviar(sock, jid, await listarProdutos(jid, cat));
        }
      }

      // --- EDIÇÃO / EXCLUSÃO DE CADASTRO ---
      if (userSession[jid] && userSession[jid].menu === 'visualizando_cadastro') {
        if (tl === '1') {
          userSession[jid] = { menu: 'editando_nome' };
          return enviar(sock, jid, 'Digite o novo *nome*:' + '\n\n0. \u{1F519} Cancelar');
        }
        if (tl === '2') {
          userSession[jid] = { menu: 'editando_endereco' };
          return enviar(sock, jid, 'Digite o novo *endereco*:' + '\n\n0. \u{1F519} Cancelar');
        }
        if (tl === '3') {
          userSession[jid] = { menu: 'editando_cidade' };
          return enviar(sock, jid, 'Digite a nova *cidade*:' + '\n\n0. \u{1F519} Cancelar');
        }
        if (tl === '4') {
          userSession[jid] = { menu: 'confirmar_exclusao' };
          return enviar(sock, jid, 'Tem certeza que deseja excluir seu cadastro? Digite *sim* ou *nao*.');
        }
      }

      // fallback
      enviar(sock, jid, 'Nao entendi. Digite *menu* para comecar.');
    }
  });
}

startBot();
