import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { io as createSocket } from 'socket.io-client';
import { createGiftHandler } from '../lib/gift-rules.js';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-battle-server-'));
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.LIVE_START_PASSWORD = 'rofer';
process.env.SCORE_FILE = path.join(temporaryDirectory, 'score.json');
const { server, io, store, snapshot, publishGift, tiktok } = await import('../server.js');

test('serves the live score, protects admin APIs, and broadcasts over Socket.IO', async t => {
  server.listen(0);
  if (!server.listening) {
    await Promise.race([
      new Promise(resolve => server.once('listening', resolve)),
      delay(3000).then(() => { throw new Error('HTTP server did not start.'); })
    ]);
  }
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = createSocket(baseUrl, { transports: ['websocket'], forceNew: true });
  const originalConnect = tiktok.connect;
  let connectCalls = 0;
  tiktok.connect = async () => {
    connectCalls += 1;
    return tiktok.getStatus();
  };
  t.after(async () => {
    tiktok.connect = originalConnect;
    client.close();
    io.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const stateEvents = [];
  client.on('state', state => stateEvents.push(state));
  const waitForState = predicate => {
    const existing = [...stateEvents].reverse().find(predicate);
    if (existing) return Promise.resolve(existing);
    return Promise.race([
      new Promise(resolve => {
        const listener = state => {
          if (predicate(state)) {
            client.off('state', listener);
            resolve(state);
          }
        };
        client.on('state', listener);
      }),
      delay(3000).then(() => { throw new Error('Expected Socket.IO state was not received.'); })
    ]);
  };
  const waitForGift = team => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('gift', listener);
      reject(new Error('Socket.IO gift event was not received.'));
    }, 3000);
    const listener = event => {
      if (event.team !== team) return;
      clearTimeout(timer);
      client.off('gift', listener);
      resolve(event);
    };
    client.on('gift', listener);
  });
  client.connect();
  await Promise.race([
    new Promise(resolve => client.once('connect', resolve)),
    delay(3000).then(() => { throw new Error('Socket.IO client did not connect.'); })
  ]);

  const initialResponse = await fetch(`${baseUrl}/api/state`);
  const initialState = await initialResponse.json();
  assert.deepEqual([initialState.score.left, initialState.score.right], [0, 0]);
  const unauthorized = await fetch(`${baseUrl}/api/admin/reset`, { method: 'POST' });
  assert.equal(unauthorized.status, 401);

  const adminHeaders = { 'x-admin-token': 'test-admin-token', 'content-type': 'application/json' };
  const wrongPassword = await fetch(`${baseUrl}/api/connect`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ password: 'wrong' })
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal((await wrongPassword.json()).error, 'Senha incorreta.');
  assert.equal(connectCalls, 0);

  const validPassword = await fetch(`${baseUrl}/api/connect`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ password: 'rofer' })
  });
  assert.equal(validPassword.status, 200);
  assert.equal(connectCalls, 1);

  const wrongAdminReconnectPassword = await fetch(`${baseUrl}/api/admin/reconnect`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ password: 'wrong' })
  });
  assert.equal(wrongAdminReconnectPassword.status, 401);
  assert.equal((await wrongAdminReconnectPassword.json()).error, 'Senha incorreta.');

  const validAdminReconnectPassword = await fetch(`${baseUrl}/api/admin/reconnect`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ password: 'rofer' })
  });
  assert.equal(validAdminReconnectPassword.status, 200);
  assert.equal(connectCalls, 2);

  const initialSocketState = await waitForState(() => true);
  assert.deepEqual([initialSocketState.score.left, initialSocketState.score.right], [0, 0]);

  const handleGift = createGiftHandler({
    store,
    log: () => {},
    onUpdate: publishGift,
    redGiftIds: new Set(),
    whiteGiftIds: new Set()
  });
  const redGiftEvent = waitForGift('left');
  handleGift({ giftDetails: { giftName: 'Rose' }, giftId: 'red-real-name', repeatCount: 1, giftType: 0, msgId: 'red-1', user: { uniqueId: 'viewer_red' } });
  const redBroadcast = await waitForState(state => state.score.left === 1);
  assert.equal((await redGiftEvent).quantity, 1);
  assert.deepEqual([redBroadcast.score.left, redBroadcast.score.right], [1, 0]);

  const whiteGiftEvent = waitForGift('right');
  handleGift({ giftDetails: { giftName: 'White Rose' }, giftId: 'white-real-name', repeatCount: 1, giftType: 0, msgId: 'white-1', user: { uniqueId: 'viewer_white' } });
  const whiteBroadcast = await waitForState(state => state.score.right === 1);
  assert.equal((await whiteGiftEvent).quantity, 1);
  assert.deepEqual([whiteBroadcast.score.left, whiteBroadcast.score.right], [1, 1]);

  const resetResponse = await fetch(`${baseUrl}/api/admin/reset`, {
    method: 'POST',
    headers: { 'x-admin-token': 'test-admin-token' }
  });
  assert.equal(resetResponse.status, 200);
  const broadcast = await waitForState(state => state.score.logs[0]?.message === 'Placar zerado pelo painel de administração.');
  assert.deepEqual([broadcast.score.left, broadcast.score.right], [0, 0]);
});