# Busca de Preços VTEX + WhatsApp

Sistema de busca de produtos em lojas VTEX (Americanas, Casas Bahia etc.) com:
- **Site estático** para buscar e comparar produtos
- **WhatsApp Bot** para receber pedidos
- **API REST** (Fastify + PostgreSQL) para persistência de pedidos/contatos

## Estrutura

```
chatbot/
├── index.html              # Homepage
├── index.js                # WhatsApp Bot
├── api/                    # API Backend (Fastify)
│   ├── src/server.js
│   ├── package.json
│   └── Dockerfile
├── paginas/                # Páginas públicas
│   ├── produtos.html       # Busca VTEX ao vivo
│   ├── carrinho.html
│   └── contato.html
├── static/                 # Recursos estáticos
│   ├── css/style.css
│   └── js/
│       ├── storage.js      # API client
│       └── components.js   # Header/Footer
├── docker-compose.yml
├── install_chatbot
└── ARQUITETURA.md
```

## Início Rápido

### API (Docker)

```bash
sudo bash install_chatbot
```

### API (desenvolvimento)

```bash
cd api
npm install
DB_HOST=localhost DB_NAME=ecommerce_db DB_USER=postgres DB_PASS=postgres node src/server.js
```

### WhatsApp Bot

```bash
npm install
API_URL=http://localhost:3000 node index.js
```

## Arquitetura

- As páginas estáticas consultam a API da VTEX ao vivo (via proxy Vercel em produção, ou via `api/vtex-proxy` em desenvolvimento)
- Pedidos e contatos são salvos na API Fastify + PostgreSQL
- WhatsApp Bot gerencia carrinhos e finaliza pedidos na mesma API
