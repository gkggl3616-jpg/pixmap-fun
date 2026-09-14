'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const WIDTH = 256;
const HEIGHT = 256;
const EMPTY = 255;
const COOLDOWN_MS = Math.max(250, Number(process.env.COOLDOWN_MS || 900));
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TIME_ZONE = process.env.TIME_ZONE || 'Europe/Istanbul';
const BLOCK_PROXIES = process.env.BLOCK_PROXIES === '1';
const PROXYCHECK_KEY = process.env.PROXYCHECK_KEY || '';

const PALETTE = [
  '#ffffff', '#d4d7d9', '#898d90', '#3a3d40', '#111418', '#7a1e2d',
  '#ed1c24', '#ff7a1a', '#f5c542', '#fff36b', '#9be564', '#35b84a',
  '#0b7a3e', '#18c6a3', '#45e6e6', '#20a4f3', '#2357d9', '#5b2a86',
  '#9b4dca', '#ed4bc7', '#ff8fab', '#8b5a2b', '#c98c4a', '#f0c7a5',
];

const pixels = new Uint8Array(WIDTH * HEIGHT);
pixels.fill(EMPTY);
const players = Object.create(null);
const clients = new Set();
const cooldowns = new Map();
const proxyCache = new Map();
let startedAt = Date.now();
let saveTimer = null;

function dayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function cleanName(value) {
  const text = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20);
  return text || 'Misafir';
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const decoded = Buffer.from(raw.pixels || '', 'base64');
    if (decoded.length === pixels.length) pixels.set(decoded);
    if (raw.players && typeof raw.players === 'object') Object.assign(players, raw.players);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('State could not be loaded:', error.message);
  }
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({
    version: 1,
    width: WIDTH,
    height: HEIGHT,
    pixels: Buffer.from(pixels).toString('base64'),
    players,
    savedAt: new Date().toISOString(),
  }));
  fs.renameSync(temp, STATE_FILE);
}

function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(saveState, 1000);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((pair) => {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at).trim()] = decodeURIComponent(pair.slice(at + 1));
  });
  return out;
}

function playerId(req, res) {
  const current = parseCookies(req).pixmap_id;
  if (/^[a-f0-9]{24}$/.test(current || '')) return current;
  const id = crypto.randomBytes(12).toString('hex');
  res.setHeader('Set-Cookie', `pixmap_id=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  return id;
}

function ensurePlayer(id, name) {
  const today = dayKey();
  const player = players[id] || { name: 'Misafir', total: 0, daily: 0, day: today };
  if (player.day !== today) {
    player.daily = 0;
    player.day = today;
  }
  if (name !== undefined) player.name = cleanName(name);
  players[id] = player;
  return player;
}

function ranks() {
  const today = dayKey();
  return Object.entries(players)
    .map(([id, player]) => ({
      id,
      name: cleanName(player.name),
      total: Number(player.total || 0),
      daily: player.day === today ? Number(player.daily || 0) : 0,
    }))
    .filter((player) => player.total > 0)
    .sort((a, b) => b.daily - a.daily || b.total - a.total || a.name.localeCompare(b.name, 'tr'))
    .slice(0, 25);
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 32768) {
        reject(Object.assign(new Error('İstek çok büyük.'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Geçersiz JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const value = req.headers['cf-connecting-ip']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress
    || '';
  return value.replace(/^::ffff:/, '');
}

function isLocalIp(ip) {
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.')
    || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

async function checkProxy(ip) {
  if (!net.isIP(ip) || isLocalIp(ip)) {
    return { checked: true, blocked: false, proxy: false, vpn: false, risk: 0, source: 'local' };
  }
  const cached = proxyCache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.value;
  const params = new URLSearchParams({ tag: '0' });
  if (PROXYCHECK_KEY) params.set('key', PROXYCHECK_KEY);
  try {
    const response = await fetch(`https://proxycheck.io/v3/${encodeURIComponent(ip)}?${params}`, {
      headers: { accept: 'application/json', 'user-agent': 'PixmapFun-Lite/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    const info = body[ip] || body.addresses?.[ip] || {};
    const detections = info.detections || {};
    const proxy = Boolean(detections.proxy || detections.tor || detections.scraper);
    const vpn = Boolean(detections.vpn);
    const anonymous = Boolean(detections.anonymous || proxy || vpn);
    const risk = Number(info.risk?.score ?? info.risk ?? 0) || 0;
    const value = {
      checked: response.ok && (body.status === 'ok' || body.status === 'warning'),
      blocked: anonymous,
      proxy,
      vpn,
      risk,
      type: Object.entries(detections).filter(([, found]) => found === true).map(([type]) => type).join(', ') || 'normal',
      source: 'proxycheck.io',
    };
    proxyCache.set(ip, { value, expires: Date.now() + 10 * 60 * 1000 });
    return value;
  } catch (error) {
    return { checked: false, blocked: false, proxy: false, vpn: false, risk: 0, source: 'unavailable' };
  }
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => client.write(payload));
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, requested);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`) && file !== path.join(PUBLIC_DIR, 'index.html')) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, {
    'content-type': types[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = playerId(req, res);
  const player = ensurePlayer(id);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, mode: 'redisless', uptime: Math.floor((Date.now() - startedAt) / 1000) });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return sendJson(res, 200, {
        width: WIDTH, height: HEIGHT, empty: EMPTY, palette: PALETTE,
        pixels: Buffer.from(pixels).toString('base64'), player, selfId: id, ranks: ranks(), online: clients.size,
        cooldownMs: COOLDOWN_MS, proxyBlocking: BLOCK_PROXIES,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ online: clients.size + 1 })}\n\n`);
      clients.add(res);
      broadcast('online', { online: clients.size });
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
        broadcast('online', { online: clients.size });
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/proxy') {
      const result = await checkProxy(clientIp(req));
      return sendJson(res, 200, { ...result, blockingEnabled: BLOCK_PROXIES });
    }
    if (req.method === 'GET' && url.pathname === '/api/ranks') {
      return sendJson(res, 200, { ranks: ranks() });
    }
    if (req.method === 'POST' && url.pathname === '/api/player') {
      const body = await readJson(req);
      const updated = ensurePlayer(id, body.name);
      scheduleSave();
      broadcast('ranks', { ranks: ranks() });
      return sendJson(res, 200, { ok: true, player: updated });
    }
    if (req.method === 'POST' && url.pathname === '/api/place') {
      const now = Date.now();
      const retry = COOLDOWN_MS - (now - Number(cooldowns.get(id) || 0));
      if (retry > 0) return sendJson(res, 429, { error: 'Biraz beklemelisin.', retryAfter: retry });
      const body = await readJson(req);
      const x = Number(body.x);
      const y = Number(body.y);
      const color = Number(body.color);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
        return sendJson(res, 400, { error: 'Geçersiz piksel koordinatı.' });
      }
      if (!Number.isInteger(color) || color < 0 || color >= PALETTE.length) {
        return sendJson(res, 400, { error: 'Geçersiz renk.' });
      }
      if (BLOCK_PROXIES) {
        const proxy = await checkProxy(clientIp(req));
        if (proxy.checked && proxy.blocked) return sendJson(res, 403, { error: 'Proxy veya VPN bağlantısında piksel basılamaz.' });
      }
      ensurePlayer(id, body.name);
      pixels[y * WIDTH + x] = color;
      players[id].total += 1;
      players[id].daily += 1;
      cooldowns.set(id, now);
      scheduleSave();
      const event = { x, y, color, by: players[id].name, at: now };
      broadcast('pixel', event);
      const currentRanks = ranks();
      broadcast('ranks', { ranks: currentRanks });
      return sendJson(res, 200, { ok: true, pixel: event, player: players[id], ranks: currentRanks });
    }
    if (req.method === 'GET' && serveStatic(req, res, url.pathname)) return;
    return sendJson(res, 404, { error: 'Bulunamadı.' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) return sendJson(res, error.status || 500, { error: error.status ? error.message : 'Sunucu hatası.' });
    res.end();
  }
}

loadState();
const server = http.createServer(handler);
server.requestTimeout = 10000;
server.headersTimeout = 12000;

function shutdown() {
  try { saveState(); } catch (error) { console.error('State could not be saved:', error.message); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Pixmap Fun Lite listening on http://${HOST}:${PORT}`));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { server, handler, pixels, players, ranks, cleanName, checkProxy };
