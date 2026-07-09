# Catálogo WhatsApp + API

Sistema de catálogo de produtos com:
- **API REST** (Fastify + PostgreSQL) para cadastro de produtos
- **WhatsApp Bot** para vendas exclusivas via chat
- **Site estático** para visualizar o catálogo e gerenciar carrinho

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
│   ├── produtos.html       # Catálogo via API
│   ├── carrinho.html       # Carrinho (finaliza via WhatsApp)
│   └── contato.html
├── static/                 # Recursos estáticos
│   ├── css/style.css
│   └── js/
│       ├── storage.js      # API client
│       └── components.js   # Header/Footer
├── data/
│   └── produtos.json       # Seed de produtos
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

## API Endpoints

### Produtos (público)
- `GET /api/produtos` - Listar produtos (filtros: `categoria`, `search`, `limit`, `offset`)
- `GET /api/produtos/:id` - Detalhes de um produto

### Produtos (requer auth)
- `POST /api/produtos` - Criar produto
- `PUT /api/produtos/:id` - Atualizar produto
- `DELETE /api/produtos/:id` - Excluir produto
- `POST /api/produtos/seed` - Importar produtos de `data/produtos.json`

### Genéricos (requer auth)
- `POST /api/create` - Criar registro (usado para pedidos)
- `POST /api/read` - Ler registros com filtros
- `POST /api/update` - Atualizar registro
- `POST /api/delete` - Excluir registro

## Vendas via WhatsApp

O bot do WhatsApp gerencia todo o fluxo de vendas:

| Comando | Descrição |
|---------|-----------|
| `produtos` | Listar catálogo |
| `produtos <categoria>` | Filtrar por categoria |
| `detalhe <id>` | Ver detalhes do produto |
| `comprar <id> [qtd]` | Adicionar ao carrinho |
| `carrinho` | Ver carrinho |
| `finalizar` | Confirmar pedido |
| `limpar` | Limpar carrinho |
