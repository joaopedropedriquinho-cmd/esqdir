import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { createGiftHandler } from './gift-rules.js';

export class TikTokService {
  constructor({ username, signApiKey, store, onUpdate = () => {}, onStatus = () => {}, log = console.log, connectionFactory }) {
    this.username = username;
    this.signApiKey = signApiKey;
    this.store = store;
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.log = log;
    this.connectionFactory = connectionFactory ?? ((uniqueId, options) => new TikTokLiveConnection(uniqueId, options));
    this.connection = null;
    this.connecting = null;
    this.retryTimer = null;
    this.retryCount = 0;
    this.shouldBeConnected = false;
    this.status = { connected: false, connecting: false, username, isLive: null, roomId: null, error: null, errorSummary: null };
    this.handleGift = createGiftHandler({ store, onUpdate, log });
  }

  publishStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.getStatus());
  }

  getStatus() {
    return { ...this.status };
  }

  summarizeError(error) {
    const message = error?.message ?? String(error);
    if (/business plan/i.test(message)) return 'O Euler Stream recusou a assinatura do WebSocket: plano Business exigido.';
    if (/isn.t online|not live|offline/i.test(message)) return `@${this.username} não está ao vivo no momento.`;
    return message;
  }

  logConnectionError(error, roomId = this.status.roomId) {
    const message = error?.message ?? String(error);
    const name = error?.name ?? 'Error';
    const code = error?.code ?? error?.statusCode ?? error?.status ?? error?.response?.statusCode ?? 'não informado';
    const stack = error?.stack ?? 'Stack não disponível.';
    const signature = `${name}:${message}:${code}`;
    if (signature === this.lastLoggedError) return;
    this.lastLoggedError = signature;
    this.log(`[TIKTOK] ERRO DE CONEXÃO: ${message}\n[TIKTOK] error.name: ${name}\n[TIKTOK] código: ${code}\n[TIKTOK] roomId: ${roomId ?? 'não encontrado'}\n[TIKTOK] stack:\n${stack}`);
  }

  connect(manual = true) {
    if (manual) this.shouldBeConnected = true;
    clearTimeout(this.retryTimer);
    if (this.connection?.isConnected) return Promise.resolve(this.getStatus());
    if (this.connecting) return this.connecting;

    this.lastLoggedError = null;
    this.publishStatus({ connected: false, connecting: true, isLive: null, roomId: null, error: null, errorSummary: null });
    this.log(`[TIKTOK] Tentando conectar em @${this.username}`);
    const connectionOptions = { enableExtendedGiftInfo: true };
    if (this.signApiKey) connectionOptions.signApiKey = this.signApiKey;
    const connection = this.connectionFactory(this.username, connectionOptions);
    this.connection = connection;

    connection.on(WebcastEvent.GIFT, this.handleGift);
    connection.on(ControlEvent.ERROR, ({ info, exception } = {}) => {
      const error = exception ?? new Error(info ?? 'Erro desconhecido na conexão TikTok.');
      const message = error?.message ?? String(error);
      this.logConnectionError(error);
      this.publishStatus({
        connected: Boolean(connection.isConnected),
        connecting: Boolean(connection.isConnecting),
        error: message,
        errorSummary: this.summarizeError(error)
      });
    });
    connection.on(ControlEvent.DISCONNECTED, ({ code, reason } = {}) => {
      this.publishStatus({ connected: false, connecting: false });
      this.log(`[TIKTOK] WebSocket desconectado (código ${code ?? 'não informado'}). ${reason ?? ''}`.trim());
      if (this.shouldBeConnected && this.status.isLive === true) this.scheduleReconnect();
    });

    this.connecting = (async () => {
      try {
        const isLive = await connection.fetchIsLive();
        const fetchedRoomId = await connection.fetchRoomId();
        const roomId = fetchedRoomId ? String(fetchedRoomId) : null;
        this.publishStatus({ isLive, roomId });
        this.log(`[TIKTOK] Verificação @${this.username}: aoVivo=${isLive}; roomId=${roomId ?? 'não encontrado'}`);

        if (!isLive) {
          this.shouldBeConnected = false;
          this.retryCount = 0;
          const message = `@${this.username} não está ao vivo no momento.`;
          this.log(`[TIKTOK] ${message} roomId=${roomId ?? 'não encontrado'}`);
          this.publishStatus({ connected: false, connecting: false, error: message, errorSummary: message });
          return this.getStatus();
        }

        if (!roomId) {
          const error = new Error(`@${this.username} está ao vivo, mas a biblioteca não retornou um room ID.`);
          error.name = 'RoomIdResolutionError';
          throw error;
        }

        const connectedState = await connection.connect(roomId);
        if (!connection.isConnected) {
          const error = new Error('TikTokLiveConnection.connect() terminou sem confirmar o WebSocket conectado.');
          error.name = 'WebSocketNotConnectedError';
          throw error;
        }
        this.retryCount = 0;
        this.publishStatus({
          connected: true,
          connecting: false,
          isLive: true,
          roomId: String(connectedState?.roomId ?? roomId),
          error: null,
          errorSummary: null
        });
        this.log(`[TIKTOK] WebSocket conectado em @${this.username}; roomId=${this.status.roomId}`);
        return this.getStatus();
      } catch (error) {
        const message = error?.message ?? String(error);
        this.logConnectionError(error);
        this.publishStatus({
          connected: Boolean(connection.isConnected),
          connecting: false,
          error: message,
          errorSummary: this.summarizeError(error)
        });
        if (this.shouldBeConnected && this.status.isLive === true) this.scheduleReconnect();
        return this.getStatus();
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  scheduleReconnect() {
    if (!this.shouldBeConnected || this.retryTimer) return;
    const delay = Math.min(2000 * (2 ** this.retryCount), 60000);
    this.retryCount += 1;
    this.log(`[TIKTOK] Nova tentativa em ${Math.round(delay / 1000)}s.`);
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
      this.log(`[TIKTOK] Erro ao desconectar: ${error.message}`);
    }
    this.publishStatus({ connected: false, connecting: false, isLive: null, error: null, errorSummary: null });
    this.log('[TIKTOK] Desconectada manualmente.');
    return this.getStatus();
  }
}