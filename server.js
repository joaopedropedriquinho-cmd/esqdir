import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketServer } from 'socket.io';
import { ScoreStore } from './lib/score-store.js';
import { TikTokService } from './lib/tiktok-service.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;
const username = (process.env.TIKTOK_USERNAME || 'quiz_azul').replace(/^@/, '');
const store = new ScoreStore(process.env.SCORE_FILE || path.join(root, 'data', 'score.json'));
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server);
let tiktok;

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      imgSrc: ["'self'", 'data:']
    }
  }
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(root, 'public')));

const snapshot = () => ({ score: store.getState(), live: tiktok?.getStatus() ?? { connected: false, connecting: false, username } });
const broadcast = () => io.emit('state', snapshot());
const publishGift = event => {
  broadcast();
  io.emit('gift', event);
};
const log = message => {
  console.log(message);
  store.addLog(message);
  broadcast();
};

tiktok = new TikTokService({
  username,
  signApiKey: process.env.TIKTOK_SIGN_API_KEY,
  store,
  log,
  onUpdate: publishGift,
  onStatus: broadcast
});

io.on('connection', socket => socket.emit('state', snapshot()));

app.get('/admin', (_request, response) => response.sendFile(path.join(root, 'public', 'admin.html')));
app.get('/api/state', (_request, response) => response.json(snapshot()));

function requireAdmin(request, response, next) {
  const expected = process.env.ADMIN_TOKEN;
  const supplied = request.get('x-admin-token') || '';
  if (!expected || expected === 'replace-with-a-long-random-secret') {
    return response.status(503).json({ error: 'Configure um ADMIN_TOKEN forte no ambiente do servidor.' });
  }
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return response.status(401).json({ error: 'Token administrativo inválido.' });
  }
  return next();
}

function requireLiveStartPassword(request, response, next) {
  const expected = process.env.LIVE_START_PASSWORD;
  if (!expected) {
    return response.status(503).json({ error: 'Configure LIVE_START_PASSWORD no ambiente do servidor.' });
  }
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(typeof request.body?.password === 'string' ? request.body.password : '');
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return response.status(401).json({ error: 'Senha incorreta.' });
  }
  return next();
}

app.post('/api/connect', requireAdmin, requireLiveStartPassword, async (_request, response) => {
  await tiktok.connect(true);
  response.json(snapshot());
});
app.post('/api/disconnect', requireAdmin, async (_request, response) => {
  await tiktok.disconnect();
  response.json(snapshot());
});
app.get('/api/admin/state', requireAdmin, (_request, response) => response.json(snapshot()));
app.post('/api/admin/reset', requireAdmin, (_request, response) => {
  store.reset();
  console.log('[ADMIN] Placar zerado.');
  broadcast();
  response.json(snapshot());
});
app.post('/api/admin/reconnect', requireAdmin, requireLiveStartPassword, async (_request, response) => {
  response.json(await tiktok.connect(true));
  broadcast();
});

app.use((request, response, next) => {
  if (request.path.startsWith('/api/')) return response.status(404).json({ error: 'Rota não encontrada.' });
  return next();
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(port, () => {
    console.log(`Live Battle disponível em http://localhost:${port}`);
  });

  function shutdown() {
    tiktok.disconnect().finally(() => server.close(() => process.exit(0)));
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export { server, io, store, tiktok, snapshot, publishGift };