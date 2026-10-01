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
    this.hasConnectedBefore = false;
    this.connectionStage = null;
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

  summarizeError(error, stage = this.connectionStage) {
    const message = error?.message ?? String(error);
    if (/business plan/i.test(message)) return 'O Euler Stream recusou a assinatura do WebSocket: plano Business exigido.';
    if (stage === 'websocket') return `Falha na conexão WebSocket do TikTok: ${message}`;
    return message;
  }

  logConnectionError(error, roomId = this.status.roomId) {
    const message = error?.message ?? String(error);
    const name = error?.name ?? 'Error';
    const code = error?.code ?? 'não informado';
    const statusCode = error?.statusCode ?? error?.status ?? 'não informado';
    const responseStatus = error?.response?.statusCode ?? error?.response?.status ?? 'não informado';
    const stack = error?.stack ?? 'Stack não disponível.';
    const signature = `${name}:${message}:${code}`;
    if (signature === this.lastLoggedError) return;
    this.lastLoggedError = signature;
    this.log(`[TIKTOK] ERRO DE CONEXÃO: ${message}\n[TIKTOK] error.name: ${name}\n[TIKTOK] error.message: ${message}\n[TIKTOK] code: ${code}\n[TIKTOK] status code: ${statusCode}\n[TIKTOK] response status: ${responseStatus}\n[TIKTOK] roomId: ${roomId ?? 'não encontrado'}\n[TIKTOK] stack:\n${stack}`);
  }

  markConnected(connection, state, roomId) {
    if (!connection.isConnected) return false;
    const wasConnected = this.status.connected;
    this.hasConnectedBefore = true;
    this.retryCount = 0;
    this.publishStatus({
      connected: true,
      connecting: false,
      isLive: true,
      roomId: String(state?.roomId ?? connection.roomId ?? roomId),
      error: null,
      errorSummary: null
    });
    if (!wasConnected) this.log(`[TIKTOK] CONECTADO À LIVE! @${this.username}; roomId=${this.status.roomId}`);
    return true;
  }

  connect(manual = true) {
    if (manual) this.shouldBeConnected = true;
    clearTimeout(this.retryTimer);
    if (this.connection?.isConnected) return Promise.resolve(this.getStatus());
    if (this.connecting) return this.connecting;

    this.lastLoggedError = null;
    this.publishStatus({ connected: false, connecting: true, isLive: null, roomId: null, error: null, errorSummary: null });
    this.log(`[TIKTOK] Buscando LIVE de @${this.username}...`);
    const connectionOptions = {
      enableExtendedGiftInfo: true,
      fetchRoomInfoOnConnect: false
    };
    if (this.signApiKey) connectionOptions.signApiKey = this.signApiKey;
    const connection = this.connectionFactory(this.username, connectionOptions);
    this.connection = connection;

    connection.on(WebcastEvent.GIFT, this.handleGift);
    connection.on(WebcastEvent.CHAT, data => {
      console.log(`[TIKTOK] Chat @${data.user?.uniqueId ?? 'desconhecido'}: ${data.comment ?? ''}`);
    });
    connection.on(ControlEvent.WEBSOCKET_CONNECTED, client => {
      this.log(`[TIKTOK] Transporte WebSocket aberto; socketOpen=${Boolean(client?.open)}`);
    });
    connection.on(ControlEvent.CONNECTED, state => {
      this.markConnected(connection, state, this.status.roomId);
    });
    connection.on(ControlEvent.ERROR, ({ info, exception } = {}) => {
      const error = exception ?? new Error(info ?? 'Erro desconhecido na conexão TikTok.');
      const message = error?.message ?? String(error);
      this.logConnectionError(error);
      this.publishStatus({
        connected: Boolean(connection.isConnected),
        connecting: Boolean(connection.isConnecting),
        error: message,
        errorSummary: this.summarizeError(error, this.connectionStage)
      });
    });
    connection.on(ControlEvent.DISCONNECTED, ({ code, reason } = {}) => {
      const wasConnected = this.hasConnectedBefore;
      this.publishStatus({ connected: false, connecting: false });
      this.log(`[TIKTOK] WebSocket desconectado (código ${code ?? 'não informado'}). ${reason ?? ''}`.trim());
      if (this.shouldBeConnected && wasConnected) this.scheduleReconnect();
    });

    this.connecting = (async () => {
      try {
        this.connectionStage = 'preflight';
        const liveCheck = await connection.fetchIsLive().catch(error => {
          this.log(`[TIKTOK] fetchIsLive falhou (informativo, não bloqueia connect(roomId)): ${error.message}`);
          return null;
        });
        const isLive = typeof liveCheck === 'boolean' ? liveCheck : null;
        this.log(`[TIKTOK] fetchIsLive=${isLive ?? 'indisponível'}; continuando resolução do roomId.`);
        const fetchedRoomId = await connection.fetchRoomId();
        const roomId = fetchedRoomId ? String(fetchedRoomId) : null;
        this.publishStatus({ isLive, roomId });
        this.log(roomId ? `[TIKTOK] Room ID encontrado: ${roomId}` : '[TIKTOK] Room ID não encontrado.');

        if (!roomId) {
          if (isLive === false) {
            const message = `@${this.username} não está ao vivo no momento e nenhum room ID foi resolvido.`;
            this.publishStatus({ connected: false, connecting: false, error: message, errorSummary: message });
            this.shouldBeConnected = false;
            return this.getStatus();
          }
          const error = new Error(`@${this.username} está ao vivo, mas a biblioteca não retornou um room ID.`);
          error.name = 'RoomIdResolutionError';
          throw error;
        }

        this.connectionStage = 'websocket';
        this.log('[TIKTOK] Tentando conexão WebSocket...');
        const connectedState = await connection.connect(roomId);
        if (!connection.isConnected) {
          const error = new Error('TikTokLiveConnection.connect() terminou sem confirmar o WebSocket conectado.');
          error.name = 'WebSocketNotConnectedError';
          throw error;
        }
        this.log('[TIKTOK] Evento connected confirmado pela biblioteca.');
        this.markConnected(connection, connectedState, roomId);
        return this.getStatus();
      } catch (error) {
        const message = error?.message ?? String(error);
        this.logConnectionError(error);
        this.publishStatus({
          connected: Boolean(connection.isConnected),
          connecting: false,
          error: message,
          errorSummary: this.summarizeError(error, this.connectionStage)
        });
        return this.getStatus();
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  scheduleReconnect() {
    if (!this.shouldBeConnected || this.retryTimer) return;
    const delay = 5000;
    this.retryCount += 1;
    this.log('[TIKTOK] Conexão perdida');
    this.log('[TIKTOK] Tentando reconectar em 5 segundos...');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(false);
    }, delay);
    this.retryTimer.unref?.();
  }

  async disconnect() {
    this.shouldBeConnected = false;
    this.hasConnectedBefore = false;
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