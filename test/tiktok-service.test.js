import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ControlEvent } from 'tiktok-live-connector';
import { TikTokService } from '../lib/tiktok-service.js';

class MockConnection extends EventEmitter {
  constructor({ isLive, roomId, connectError } = {}) {
    super();
    this.live = isLive;
    this.resolvedRoomId = roomId;
    this.connectError = connectError;
    this.isConnected = false;
    this.isConnecting = false;
    this.calls = [];
  }

  async fetchIsLive() {
    this.calls.push('fetchIsLive');
    return this.live;
  }

  async fetchRoomId() {
    this.calls.push('fetchRoomId');
    return this.resolvedRoomId;
  }

  async connect(roomId) {
    this.calls.push(['connect', roomId]);
    if (this.connectError) throw this.connectError;
    this.isConnected = true;
    return { roomId };
  }

  async disconnect() {
    this.isConnected = false;
  }
}

function createService(connection, logs = []) {
  return new TikTokService({
    username: 'quiz_azul',
    store: {},
    log: message => logs.push(message),
    connectionFactory: (username, options) => {
      assert.equal(username, 'quiz_azul');
      assert.equal(options.enableExtendedGiftInfo, true);
      return connection;
    }
  });
}

test('offline preflight reports stale room ID and never attempts WebSocket or retries', async () => {
  const connection = new MockConnection({ isLive: false, roomId: '7691492422651644680' });
  const logs = [];
  const service = createService(connection, logs);
  let retries = 0;
  service.scheduleReconnect = () => { retries += 1; };

  const state = await service.connect();

  assert.deepEqual(connection.calls, ['fetchIsLive', 'fetchRoomId']);
  assert.equal(state.isLive, false);
  assert.equal(state.roomId, '7691492422651644680');
  assert.equal(state.connected, false);
  assert.equal(state.error, '@quiz_azul não está ao vivo no momento.');
  assert.equal(retries, 0);
  assert.ok(logs.includes('[TIKTOK] Tentando conectar em @quiz_azul'));
  assert.ok(logs.some(message => message.includes('roomId=7691492422651644680')));
});

test('online room ID is passed to connect and connected is true only after WebSocket opens', async () => {
  const connection = new MockConnection({ isLive: true, roomId: 'room-live-123' });
  const logs = [];
  const service = createService(connection, logs);

  const state = await service.connect();

  assert.deepEqual(connection.calls, ['fetchIsLive', 'fetchRoomId', ['connect', 'room-live-123']]);
  assert.equal(state.isLive, true);
  assert.equal(state.roomId, 'room-live-123');
  assert.equal(state.connected, true);
  assert.ok(logs.some(message => message.includes('[TIKTOK] WebSocket conectado em @quiz_azul')));
});

test('WebSocket signing failure logs message, name, code, stack, and room ID and keeps retry enabled while live', async () => {
  const error = Object.assign(new Error('Euler requires a Business plan'), { code: 'PREMIUM_REQUIRED' });
  const connection = new MockConnection({ isLive: true, roomId: 'room-live-456', connectError: error });
  const logs = [];
  const service = createService(connection, logs);
  let retries = 0;
  service.scheduleReconnect = () => { retries += 1; };

  const state = await service.connect();
  const errorLog = logs.find(message => message.includes('[TIKTOK] ERRO DE CONEXÃO:'));

  assert.equal(state.connected, false);
  assert.equal(state.error, error.message);
  assert.match(state.errorSummary, /plano Business/i);
  assert.match(errorLog, /error\.name: Error/);
  assert.match(errorLog, /PREMIUM_REQUIRED/);
  assert.match(errorLog, /roomId: room-live-456/);
  assert.match(errorLog, /stack:/);
  assert.equal(retries, 1);
});

test('an online WebSocket disconnect schedules automatic reconnection', async () => {
  const connection = new MockConnection({ isLive: true, roomId: 'room-live-789' });
  const service = createService(connection);
  let retries = 0;
  service.scheduleReconnect = () => { retries += 1; };
  await service.connect();

  connection.emit(ControlEvent.DISCONNECTED, { code: 1006, reason: 'network closed' });

  assert.equal(service.getStatus().connected, false);
  assert.equal(retries, 1);
});