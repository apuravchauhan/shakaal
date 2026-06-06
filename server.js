require('dotenv').config();
const express  = require('express');
const { WebSocketServer } = require('ws');
const pty      = require('node-pty');
const http     = require('http');
const path     = require('path');
const url      = require('url');
const fs       = require('fs');
const crypto   = require('crypto');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

// ── Config ────────────────────────────────────────────────────────────────────
const PORTAL_KEY      = process.env.PORTAL_KEY;
const IS_WIN          = process.platform === 'win32';
const LAUNCH_CMD      = process.env.LAUNCH_CMD
  || process.env.SHELL
  || (IS_WIN ? 'powershell.exe' : '/bin/zsh');
const SCROLLBACK_SIZE = 200 * 1024;
const MAX_SESSIONS    = 20;
const MAX_FAILURES    = 3;
const BLOCKLIST_FILE  = path.join(__dirname, 'blocklist.json');

if (!PORTAL_KEY) {
  console.error('PORTAL_KEY is not set. Add it to .env');
  process.exit(1);
}

// ── Blocklist ─────────────────────────────────────────────────────────────────
let blocklist = new Set();
try {
  blocklist = new Set(JSON.parse(fs.readFileSync(BLOCKLIST_FILE, 'utf8')));
} catch (_) {}

function saveBlocklist() {
  fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify([...blocklist], null, 2));
}

function reloadBlocklist() {
  try {
    blocklist = new Set(JSON.parse(fs.readFileSync(BLOCKLIST_FILE, 'utf8')));
  } catch (_) { blocklist = new Set(); }
}

// ── Auth state ────────────────────────────────────────────────────────────────
const validTokens = new Set();
const failCounts  = new Map(); // ip → number

// ── Helpers ───────────────────────────────────────────────────────────────────
function getIP(req) {
  const raw = req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]
    || req.socket.remoteAddress
    || '';
  return raw.trim().replace(/^::ffff:/, '');
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}

function isAuthenticated(req) {
  const token = parseCookies(req).portal_token;
  return !!(token && validTokens.has(token));
}

function tokenCookie(token) {
  return `portal_token=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  reloadBlocklist();
  if (blocklist.has(getIP(req))) return res.status(403).send('Access denied.');
  next();
});

// ── Public routes (no auth) ───────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/');
  const err = req.query.error ? '<p class="err">Invalid key — try again.</p>' : '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Access</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#000;color:#e0e0e0;font-family:'Menlo','Monaco','Courier New',monospace;
         height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:#060606;border:1px solid #2a2a2a;border-radius:8px;padding:32px;width:300px}
    h1{font-size:13px;font-weight:600;color:#fff;margin-bottom:20px;letter-spacing:.02em}
    input{width:100%;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;
          font-family:inherit;font-size:13px;padding:8px 12px;outline:none;margin-bottom:12px}
    input:focus{border-color:#57c7ff}
    button{width:100%;background:#57c7ff;border:none;border-radius:6px;color:#000;
           font-family:inherit;font-size:13px;font-weight:700;padding:9px;cursor:pointer}
    button:hover{background:#7dd3fc}
    .err{color:#ff5f57;font-size:11px;margin-bottom:10px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Enter access key</h1>
    ${err}
    <form method="POST" action="/auth">
      <input type="password" name="key" placeholder="key" autofocus autocomplete="off"/>
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>`);
});

app.post('/auth', (req, res) => {
  const ip  = getIP(req);
  const key = (req.body.key || '').trim();

  if (key === PORTAL_KEY) {
    failCounts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    res.setHeader('Set-Cookie', tokenCookie(token));
    return res.redirect('/');
  }

  const failures = (failCounts.get(ip) || 0) + 1;
  failCounts.set(ip, failures);

  if (failures >= MAX_FAILURES) {
    blocklist.add(ip);
    saveBlocklist();
    console.warn(`[auth] IP blocked after ${MAX_FAILURES} failed attempts: ${ip}`);
    return res.status(403).send('Too many failed attempts. Access denied.');
  }

  console.warn(`[auth] failed attempt ${failures}/${MAX_FAILURES} from ${ip}`);
  res.redirect('/login?error=1');
});

// ── Auth wall — everything below requires a valid session ─────────────────────
app.use((req, res, next) => {
  if (isAuthenticated(req)) return next();
  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/sessions', (req, res) => {
  res.json([...sessions.keys()]);
});

// ── Terminal sessions ─────────────────────────────────────────────────────────
const sessions = new Map();

function sanitizeName(raw) {
  return (raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'terminal';
}

function safeCwd(requested) {
  try {
    const resolved = path.resolve(requested);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
  } catch (_) {}
  return process.env.HOME;
}

function broadcastToSession(name, msg) {
  const session = sessions.get(name);
  if (!session) return;
  const data = JSON.stringify(msg);
  session.clients.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(data); });
}

function createSession(name, cwd) {
  const ptyProcess = pty.spawn(LAUNCH_CMD, [], {
    name: 'xterm-256color', cols: 80, rows: 24, cwd, env: process.env,
  });
  console.log(`[${name}] spawned PID ${ptyProcess.pid} — cwd: ${cwd}`);

  const session = { ptyProcess, clients: new Set(), scrollback: '', cwd };
  sessions.set(name, session);

  ptyProcess.onData((data) => {
    session.scrollback += data;
    if (session.scrollback.length > SCROLLBACK_SIZE)
      session.scrollback = session.scrollback.slice(-SCROLLBACK_SIZE);
    broadcastToSession(name, { type: 'output', data });
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[${name}] exited (code ${exitCode})`);
    broadcastToSession(name, { type: 'exit', code: exitCode });
    sessions.delete(name);
  });

  return session;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const ip = getIP(req);

  reloadBlocklist();
  if (blocklist.has(ip)) { ws.close(); return; }
  if (!isAuthenticated(req)) { ws.close(); return; }

  const params = new url.URL(req.url, 'http://localhost').searchParams;
  const name   = sanitizeName(params.get('name'));
  const cwd    = safeCwd(params.get('cwd') || process.env.HOME);

  let session = sessions.get(name);
  if (session) {
    console.log(`[${name}] reattached`);
  } else {
    if (sessions.size >= MAX_SESSIONS) {
      ws.send(JSON.stringify({ type: 'error', message: 'Max sessions reached' }));
      ws.close();
      return;
    }
    session = createSession(name, cwd);
  }

  session.clients.add(ws);

  if (session.scrollback)
    ws.send(JSON.stringify({ type: 'output', data: session.scrollback }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if      (msg.type === 'input')       session.ptyProcess.write(msg.data);
      else if (msg.type === 'resize')      session.ptyProcess.resize(msg.cols, msg.rows);
      else if (msg.type === 'end-session') session.ptyProcess.kill();
    } catch (e) { console.error(`[${name}] bad message:`, e.message); }
  });

  ws.on('close', () => {
    session.clients.delete(ws);
    console.log(`[${name}] client detached (${session.clients.size} remaining)`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\nWeb terminal ready → http://localhost:${PORT}\n`);
});
