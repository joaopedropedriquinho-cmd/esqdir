import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { createGiftHandler } from './gift-rules.js';

export class TikTokService {
  constructor({ username, signApiKey, store, onUpdate = () => {}, onStatus = () => {}, log = console.log }) {
    this.username = username;
    this.signApiKey = signApiKey;
    this.store = store;
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.log = log;
    this.connection = null;
    this.connecting = null;
    this.retryTimer = null;
    this.retryCount = 0;
    this.shouldBeConnected = true;
    this.status = { connected: false, connecting: false, username, error: null };
    this.handleGift = createGiftHandler({ store, onUpdate, log });
  }

  publishStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.getStatus());
  }

  getStatus() {
    return { ...this.status };
  }

  connect(manual = true) {
    if (manual) this.shouldBeConnected = true;
    clearTimeout(this.retryTimer);
    if (this.connection?.isConnected) return Promise.resolve(this.getStatus());
    if (this.connecting) return this.connecting;

    this.publishStatus({ connected: false, connecting: true, error: null });
    this.log(`[LIVE] Conectando à live @${this.username}...`);
    const connectionOptions = { enableExtendedGiftInfo: true };
    if (this.signApiKey) connectionOptions.signApiKey = this.signApiKey;
    const connection = new TikTokLiveConnection(this.username, connectionOptions);
    this.connection = connection;

    connection.on(WebcastEvent.GIFT, this.handleGift);
    connection.on(ControlEvent.ERROR, ({ info, exception } = {}) => {
      const message = exception?.message ?? info ?? 'Erro desconhecido na conexão TikTok.';
      this.log(`[LIVE] Erro: ${message}`);
      this.publishStatus({ error: String(message) });
    });
    connection.on(ControlEvent.DISCONNECTED, ({ code, reason } = {}) => {
      this.publishStatus({ connected: false, connecting: false });
      this.log(`[LIVE] Desconectada (código ${code ?? 'n/d'}). ${reason ?? ''}`.trim());
      if (this.shouldBeConnected) this.scheduleReconnect();
    });

    this.connecting = connection.connect()
      .then(() => {
        this.retryCount = 0;
        this.publishStatus({ connected: true, connecting: false, error: null });
        this.log(`[LIVE] Conectada à live @${this.username}.`);
        return this.getStatus();
      })
      .catch(error => {
        const message = error?.message ?? String(error);
        this.publishStatus({ connected: false, connecting: false, error: message });
        this.log(`[LIVE] Falha ao conectar: ${message}`);
        if (this.shouldBeConnected) this.scheduleReconnect();
        return this.getStatus();
      })
      .finally(() => { this.connecting = null; });
    return this.connecting;
  }

  scheduleReconnect() {
    if (!this.shouldBeConnected || this.retryTimer) return;
    const delay = Math.min(2000 * (2 ** this.retryCount), 60000);
    this.retryCount += 1;
    this.log(`[LIVE] Nova tentativa em ${Math.round(delay / 1000)}s.`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(false);
    }, delay);
    this.retryTimer.unref?.();
  }

  async disconnect() {
    this.shouldBeConnected = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.publishStatus({ connecting: false });
    try {
      await this.connection?.disconnect();
    } catch (error) {
      this.log(`[LIVE] Erro ao desconectar: ${error.message}`);
    }
    this.publishStatus({ connected: false, connecting: false, error: null });
    this.log('[LIVE] Desconectada manualmente.');
    return this.getStatus();
  }
}