# Arquitetura do Sistema Catálogo WhatsApp

## Visão Geral

```
[Usuário] --> [Nginx / Docker] --> [Páginas Estáticas (HTML/CSS/JS)]
                                --> [API Fastify (Docker)]
                                       --> [PostgreSQL]
                          (port 80)       (port 3000)       (5432)

[WhatsApp] --> [Bot Node.js (whatsapp-web.js)]
           --> [API Fastify]
```

## Componentes

### 1. Páginas Estáticas (Frontend)
- `index.html` - Homepage com categorias e produtos em destaque
- `paginas/produtos.html` - Catálogo de produtos (via API local)
- `paginas/carrinho.html` - Carrinho (finalização via WhatsApp)
- `paginas/contato.html` - Contato
- `static/` - CSS, JS, ícones

### 2. API Node.js (Backend)
- **Framework**: Fastify
- **Porta**: 3000
- **Banco**: PostgreSQL
- **CRUD de Produtos**: `/api/produtos` (listar, criar, atualizar, excluir)
- **Endpoint genérico**: `/api/create`, `/api/read`, `/api/update`, `/api/delete`

### 3. WhatsApp Bot
- **Biblioteca**: whatsapp-web.js
- **Comandos**: produtos, comprar, carrinho, finalizar, detalhe, limpar
- **Consumo da API**: via REST (fetch)

## Fluxo de Dados

1. Produtos são cadastrados via API (`POST /api/produtos`) ou seed (`POST /api/produtos/seed`)
2. Usuário navega no site ou WhatsApp para ver o catálogo
3. Usuário adiciona produtos ao carrinho (localStorage no site / cache no bot)
4. Usuário finaliza pedido exclusivamente pelo WhatsApp (comando `finalizar`)
5. Pedido é salvo na API Fastify + PostgreSQL
6. Atendente entra em contato para pagamento e entrega

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
| `GET /api/produtos` | GET | Listar produtos (filtros: categoria, search) |
| `GET /api/produtos/:id` | GET | Detalhes do produto |
| `POST /api/produtos` | POST | Criar produto |
| `PUT /api/produtos/:id` | PUT | Atualizar produto |
| `DELETE /api/produtos/:id` | DELETE | Excluir produto |
| `POST /api/produtos/seed` | POST | Importar produtos do JSON |

## Banco de Dados (PostgreSQL)

- `produtos` - Catálogo de produtos
- `pedidos` - Pedidos realizados (via WhatsApp)
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
