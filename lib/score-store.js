import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_EVENTS = 20;
const MAX_LOGS = 100;
const MAX_PROCESSED_IDS = 3000;

export class ScoreStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = { left: 0, right: 0, events: [], logs: [], updatedAt: new Date().toISOString() };
    this.processedIds = [];
    this.processedIdSet = new Set();
    this.load();
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.state = { ...this.state, ...saved.state };
      this.processedIds = Array.isArray(saved.processedIds) ? saved.processedIds.slice(-MAX_PROCESSED_IDS) : [];
      this.processedIdSet = new Set(this.processedIds);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Não foi possível ler o placar: ${error.message}`);
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ state: this.state, processedIds: this.processedIds }));
    fs.renameSync(temporaryPath, this.filePath);
  }

  getState() {
    return structuredClone(this.state);
  }

  hasProcessedGift(id) {
    return this.processedIdSet.has(id);
  }

  markGiftProcessed(id) {
    if (this.processedIdSet.has(id)) return;
    this.processedIds.push(id);
    this.processedIdSet.add(id);
    if (this.processedIds.length > MAX_PROCESSED_IDS) {
      this.processedIds = this.processedIds.slice(-MAX_PROCESSED_IDS);
      this.processedIdSet = new Set(this.processedIds);
    }
    this.persist();
  }

  addGift({ team, quantity, username, giftName, giftId }) {
    this.state[team] += quantity;
    const event = {
      id: randomUUID(),
      team,
      quantity,
      username: `@${String(username).replace(/^@/, '')}`,
      giftName,
      giftId,
      timestamp: new Date().toISOString()
    };
    this.state.events = [event, ...this.state.events].slice(0, MAX_EVENTS);
    this.state.updatedAt = event.timestamp;
    this.persist();
    return event;
  }

  addLog(message) {
    this.state.logs = [{ message, timestamp: new Date().toISOString() }, ...this.state.logs].slice(0, MAX_LOGS);
    this.state.updatedAt = this.state.logs[0].timestamp;
    this.persist();
  }

  reset() {
    this.state.left = 0;
    this.state.right = 0;
    this.addLog('Placar zerado pelo painel de administração.');
  }
}