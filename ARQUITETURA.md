# Arquitetura do Sistema E-commerce

## Visão Geral

```
[Usuário] --> [Nginx/Servidor] --> [Páginas Estáticas (HTML/CSS/JS)]
                               --> [API Fastify (Docker)]
                                      --> [PostgreSQL]
                        (port 80)       (port 3000)       (5432)

[WhatsApp] --> [Bot Node.js (whatsapp-web.js)]
           --> [API Fastify]
```

## Componentes

### 1. Páginas Estáticas (Frontend)
- `index.html` - Homepage
- `paginas/produtos.html` - Catálogo de produtos
- `paginas/carrinho.html` - Carrinho de compras
- `paginas/contato.html` - Contato
- `admin/index.html` - Dashboard administrativo
- `admin/produtos.html` - Gestão de produtos
- `admin/pedidos.html` - Gestão de pedidos
- `static/` - CSS, JS, ícones

### 2. API Node.js (Backend)
- **Framework**: Fastify
- **Porta**: 3000
- **Banco**: PostgreSQL

### 3. WhatsApp Bot
- **Biblioteca**: whatsapp-web.js
- **Consumo da API**: via REST (fetch)

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

## Banco de Dados (PostgreSQL)

- `produtos` - Catálogo de produtos
- `carrinhos` - Carrinhos de clientes
- `pedidos` - Pedidos realizados
- `contatos` - Mensagens de contato
- `configuracoes` - Configurações do sistema

## Deploy

```bash
# Desenvolvimento local (API)
cd api && npm install && npm start

# Produção (Docker)
sudo bash deploy.sh
```
