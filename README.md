# E-commerce WhatsApp + Site Estático

Sistema completo de e-commerce com:
- **WhatsApp Bot** para atendimento e vendas
- **Site estático** para navegação web
- **API REST** (Fastify + PostgreSQL) para persistência de dados

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
│   ├── produtos.html
│   ├── carrinho.html
│   └── contato.html
├── admin/                  # Painel administrativo
│   ├── index.html
│   ├── produtos.html
│   └── pedidos.html
├── static/                 # Recursos estáticos
│   ├── css/style.css
│   └── js/
│       ├── storage.js      # API client
│       └── components.js   # Header/Footer
├── docker-compose.yml
├── deploy.sh
└── ARQUITETURA.md
```

## Início Rápido

### API (Docker)

```bash
sudo bash deploy.sh
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

As páginas estáticas (HTML/CSS/JS) consomem a API via `storage.js`.
O WhatsApp Bot também consome a mesma API para dados persistentes.
Veja `ARQUITETURA.md` para detalhes.
