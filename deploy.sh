
#!/usr/bin/env bash
set -euo pipefail

# ---------------- Configuration (edit as needed) ----------------
APP_USER="deployuser"
APP_DIR="/opt/projetos_api"
NODE_APP_ENTRY="index.js"
API_PORT=3000
APACHE_SITES_AVAILABLE="/etc/apache2/sites-available"
APACHE_SITE_CONF="projetos.conf"
PG_SUPERUSER="postgres"
UPLOADS_DIR="/var/www/projetos_uploads"
STATIC_DIR="/var/www/projetos_static"
ADMIN_USER="admin"                 # default admin user
ADMIN_PASS="changeme"              # default admin pass (dev). In prod use ADMIN_PASS_HASH instead.
JWT_SECRET="troque_este_segredo"   # set strong secret in prod
TOKEN_EXP="12h"
# ----------------------------------------------------------------

echo "==> Preparando sistema..."
sudo apt-get update
sudo apt-get install -y nodejs npm apache2 libapache2-mod-proxy-html libxml2-dev build-essential

echo "==> Criando usuários e diretórios..."
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  sudo useradd -r -s /usr/sbin/nologin "$APP_USER" || true
fi
sudo mkdir -p "$APP_DIR"
sudo mkdir -p "$UPLOADS_DIR"
sudo mkdir -p "$STATIC_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR" "$UPLOADS_DIR" "$STATIC_DIR"

echo "==> Escrevendo aplicação Node.js em $APP_DIR..."
cat > "$APP_DIR/$NODE_APP_ENTRY" <<'NODEAPP'
/* index.js - API Express com autenticação JWT */
const express = require('express');
const { Pool, Client } = require('pg');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const APP_PORT = process.env.PORT || 3000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/www/projetos_uploads';
const JWT_SECRET = process.env.JWT_SECRET || 'troque_este_segredo';
const TOKEN_EXP = process.env.TOKEN_EXP || '12h';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || ''; // prefer hashed in prod

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const adminPool = new Pool({ database: 'postgres' });

function safeName(name){
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

async function ensureDatabase(project){
  const dbName = 'proj_' + safeName(project);
  const client = await adminPool.connect();
  try {
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rowCount === 0){
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log('Database created:', dbName);
    }
    return dbName;
  } finally {
    client.release();
  }
}

function getClientForDB(dbName){
  return new Client({ database: dbName });
}

// Auth helpers
async function verifyAdminCredentials(user, pass){
  if (user !== ADMIN_USER) return false;
  if (ADMIN_PASS_HASH){
    return await bcrypt.compare(pass, ADMIN_PASS_HASH);
  } else {
    const envPass = process.env.ADMIN_PASS || '';
    if (!envPass) return false;
    return pass === envPass;
  }
}

function generateToken(payload){
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXP });
}

function authMiddleware(req, res, next){
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = auth.slice(7);
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch(err){
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Auth endpoint
app.post('/auth', async (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: 'user+pass required' });
  const ok = await verifyAdminCredentials(user, pass);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const token = generateToken({ user });
  res.json({ token, expiresIn: TOKEN_EXP });
});

// Protect project routes
app.use('/projects', authMiddleware);

// Schema endpoint
app.post('/projects/:project/schema', async (req, res) => {
  try{
    const project = req.params.project;
    const dbName = await ensureDatabase(project);
    const client = getClientForDB(dbName);
    await client.connect();
    const tables = req.body.tables || [];
    for (const t of tables){
      const tname = t.name.replace(/[^a-zA-Z0-9_]/g,'_').toLowerCase();
      const cols = t.columns || {};
      const colDefs = Object.entries(cols).map(([col, type]) => `"${col.replace(/[^a-zA-Z0-9_]/g,'_')}" ${type}`).join(', ');
      const sql = `CREATE TABLE IF NOT EXISTS "${tname}" (id serial primary key${colDefs ? ', ' + colDefs : ''})`;
      await client.query(sql);
    }
    await client.end();
    res.json({ ok: true });
  }catch(err){ console.error(err); res.status(500).json({ error: String(err) }); }
});

// Generic CRUD
app.post('/projects/:project/:table', async (req, res) => {
  try{
    const project = req.params.project;
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g,'_');
    const dbName = await ensureDatabase(project);
    const client = getClientForDB(dbName);
    await client.connect();
    const payload = req.body;
    const cols = Object.keys(payload).map(c => `"${c.replace(/[^a-zA-Z0-9_]/g,'_')}"`);
    const vals = Object.values(payload);
    const idxs = vals.map((_,i) => `$${i+1}`).join(',');
    const sql = `INSERT INTO "${table}" (${cols.join(',')}) VALUES (${idxs}) RETURNING *`;
    const r = await client.query(sql, vals);
    await client.end();
    res.json(r.rows[0]);
  }catch(err){ console.error(err); res.status(500).json({ error: String(err) }); }
});

app.get('/projects/:project/:table', async (req, res) => {
  try{
    const project = req.params.project;
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g,'_');
    const dbName = await ensureDatabase(project);
    const client = getClientForDB(dbName);
    await client.connect();
    const r = await client.query(`SELECT * FROM "${table}"`);
    await client.end();
    res.json(r.rows);
  }catch(err){ console.error(err); res.status(500).json({ error: String(err) }); }
});

app.get('/projects/:project/:table/:id', async (req, res) => {
  try{
    const project = req.params.project;
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g,'_');
    const id = req.params.id;
    const dbName = await ensureDatabase(project);
    const client = getClientForDB(dbName);
    await client.connect();
    const r = await client.query(`SELECT * FROM "${table}" WHERE id = $1`, [id]);
    await client.end();
    res.json(r.rows[0] || null);
  }catch(err){ console.error(err); res.status(500).json({ error: String(err) }); }
});

app.put('/projects/:project/:table/:id', async (req, res) => {
  try{
    const project = req.params.project;
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g,'_');
    const id = req.params.id;
    const dbName = await ensureDatabase(project);
    const client = getClientForDB(dbName);
    await client.connect();
    const payload = req.body;
    const sets = Object.keys(payload).map((k,i)=>`"${k}" = $${i+1}`).join(', ');
    const vals = Object.values(payload);
    vals.push(id);
    const sql = `UPDATE "${table}" SET ${sets} WHERE id = $${vals.length} RETURNING *`;
    const r = await client.query(sql, vals);
    await client.end();
    res.json(r.rows[0] || null);
  }catch(err){ console.error(err); res.status(500).json({ error: String(err) }); }
});

app.delete('/projects/:project/:table/:id', async (req, res) => {
  try{
    const project = req.params.project;
    const table = req.params.table.replace(/[^a-zA-Z0-9_]/g,'_');
    const id = req.params.id;
    const dbName = await ensureDatabase(project);
    const client = getClientForDB(dbName);
    await client.connect();
    const r = await client.query(`DELETE FROM "${table}" WHERE id = $1 RETURNING *`, [id]);
    await client.end();
    res.json({ deleted: r.rows[0] || null });
  }catch(err){ console.error(err); res.status(500).json({ error: String(err) }); }
});

// File upload/download (protected)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const project = req.params.project || 'common';
    const dir = path.join(UPLOADS_DIR, project);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const name = Date.now() + '-' + file.originalname.replace(/\s+/g,'_');
    cb(null, name);
  }
});
const upload = multer({ storage });

app.post('/projects/:project/upload', upload.single('file'), (req, res) => {
  res.json({ file: req.file });
});

app.get('/projects/:project/download/:filename', (req, res) => {
  const project = req.params.project;
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, project, filename);
  if (fs.existsSync(filePath)) return res.download(filePath);
  res.status(404).json({ error: 'not found' });
});

app.listen(APP_PORT, () => console.log('API running on port', APP_PORT));
NODEAPP

cat > "$APP_DIR/package.json" <<'PKG'
{
  "name": "projetos_api",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.10.0",
    "multer": "^1.4.5",
    "body-parser": "^1.20.2",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.1.0"
  }
}
PKG

echo "==> Instalando dependências npm..."
cd "$APP_DIR"
npm install --production

echo "==> Configurando pm2..."
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

# Export env file for pm2
PM2_ENV_FILE="$APP_DIR/.env_pm2"
cat > "$PM2_ENV_FILE" <<ENV
PORT=$API_PORT
UPLOADS_DIR=$UPLOADS_DIR
ADMIN_USER=$ADMIN_USER
ADMIN_PASS=$ADMIN_PASS
# For production, prefer ADMIN_PASS_HASH (bcrypt) instead of ADMIN_PASS:
# ADMIN_PASS_HASH=\$2b\$12\$...
JWT_SECRET=$JWT_SECRET
TOKEN_EXP=$TOKEN_EXP
ENV

# Start app with pm2 using env file
pm2 start "$APP_DIR/$NODE_APP_ENTRY" --name projetos_api --env production --update-env -- -e production
# Apply env vars to pm2 process
pm2 restart projetos_api --update-env
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null || true

echo "==> Configurando Apache2 site e proxy..."
sudo a2enmod proxy proxy_http headers rewrite
sudo bash -c "cat > $APACHE_SITES_AVAILABLE/$APACHE_SITE_CONF" <<APACHE
<VirtualHost *:80>
  ServerName projetos.local

  DocumentRoot $STATIC_DIR
  <Directory $STATIC_DIR>
    Require all granted
    AllowOverride All
  </Directory>

  # Proxy /api to Node
  ProxyPreserveHost On
  ProxyPass /api http://127.0.0.1:$API_PORT/
  ProxyPassReverse /api http://127.0.0.1:$API_PORT/

  # Serve uploads directly
  Alias /uploads $UPLOADS_DIR
  <Directory $UPLOADS_DIR>
    Require all granted
  </Directory>

  ErrorLog \${APACHE_LOG_DIR}/projetos_error.log
  CustomLog \${APACHE_LOG_DIR}/projetos_access.log combined
</VirtualHost>
APACHE

sudo mkdir -p "$STATIC_DIR"
sudo chown -R "$USER":"$USER" "$STATIC_DIR"
sudo a2ensite "$APACHE_SITE_CONF" || true
sudo systemctl reload apache2

echo "==> Finalizado."
echo "Pontos importantes:"
echo "- Páginas estáticas: $STATIC_DIR"
echo "- Uploads: $UPLOADS_DIR (exponível via /uploads/<project>/<file>)"
echo "- API proxy: http://<host>/api (autenticação JWT)"
echo "- Gerar token: POST /api/auth {\"user\":\"$ADMIN_USER\",\"pass\":\"$ADMIN_PASS\"}"
echo ""
echo "Recomendações de produção:"
echo "- Defina ADMIN_PASS_HASH com hash bcrypt em vez de ADMIN_PASS."
echo "- Defina JWT_SECRET forte e armazene em variáveis de ambiente seguras."
echo "- Ative HTTPS no Apache e restrinja acesso à API conforme necessário."
```

Observações rápidas:
- Para gerar hash bcrypt localmente: node -e "console.log(require('bcrypt').hashSync('senha', 10))" e então exportar ADMIN_PASS_HASH com o valor.
- Em produção, remova ADMIN_PASS do script e exporte apenas ADMIN_PASS_HASH e JWT_SECRET antes de iniciar pm2.
- O script assume que o PostgreSQL já está instalado e acessível via socket/usuário postgres (peer). Se usar autenticação por senha, exporte PGUSER/PGPASSWORD/PGHOST conforme necessário no ambiente do processo pm2.

Q
