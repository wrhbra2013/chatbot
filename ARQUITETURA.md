# Arquitetura do Sistema Busca de Preços

## Visão Geral

```
[Usuário] --> [GitHub Pages / Nginx] --> [Páginas Estáticas (HTML/CSS/JS)]
                                     --> [VTEX API (proxy Vercel)]
                                     --> [API Fastify (Docker)]
                                            --> [PostgreSQL]
                              (port 80)        (port 3000)       (5432)

[WhatsApp] --> [Bot Node.js (whatsapp-web.js)]
           --> [API Fastify]
```

## Componentes

### 1. Páginas Estáticas (Frontend)
- `index.html` - Homepage com lista de lojas
- `paginas/produtos.html` - Busca ao vivo na VTEX
- `paginas/carrinho.html` - Carrinho de compras
- `paginas/contato.html` - Contato
- `static/` - CSS, JS, ícones

### 2. API Node.js (Backend)
- **Framework**: Fastify
- **Porta**: 3000
- **Banco**: PostgreSQL
- **Proxy VTEX**: `/api/vtex-proxy` (para desenvolvimento local)

### 3. WhatsApp Bot
- **Biblioteca**: whatsapp-web.js
- **Consumo da API**: via REST (fetch)

## Fluxo de Dados

1. Usuário acessa o site e busca produtos em lojas VTEX
2. A busca consulta a API da VTEX ao vivo (via proxy)
3. Usuário adiciona produtos ao carrinho (localStorage)
4. Usuário finaliza pedido → salvo na API Fastify
5. WhatsApp Bot gerencia pedidos e notifica o lojista

## Endpoints da API

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `GET /health` | GET | Health check |
| `GET /ping` | GET | Ping |
| `GET /data/{tabela}` | GET | Listar registros (público) |
| `GET /config/{chave}` | GET | Obter configuração (público) |
| `POST /api/config` | GET | Obter token público |
| `POST /api/config/set` | POST | Salvar configuração |
| `POST /api/create` | POST | Criar registro |
| `POST /api/read` | POST | Ler com filtros |
| `POST /api/update` | POST | Atualizar registro |
| `POST /api/delete` | POST | Deletar registro |
| `GET /api/vtex-proxy` | GET | Proxy para API VTEX |

## Banco de Dados (PostgreSQL)

- `pedidos` - Pedidos realizados
- `contatos` - Mensagens de contato
- `carrinhos` - Carrinhos de clientes
- `configuracoes` - Configurações do sistema

## Deploy

```bash
# Instalação completa (Docker)
sudo bash install_chatbot

# Desenvolvimento local (API)
cd api && npm install && npm start
```
