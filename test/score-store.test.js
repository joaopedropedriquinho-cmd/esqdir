import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScoreStore } from '../lib/score-store.js';

test('starts at zero and preserves scores, recent gifts, logs, and deduplication IDs', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-battle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'score.json');
  const store = new ScoreStore(filePath);
  assert.deepEqual([store.getState().left, store.getState().right], [0, 0]);

  store.addGift({ team: 'left', quantity: 3, username: '@ana', giftName: 'Rose', giftId: '5655', dedupeId: 'msg-1' });
  store.addLog('ROSA VERMELHA → ESQUERDA +3');
  const restored = new ScoreStore(filePath);
  assert.deepEqual([restored.getState().left, restored.getState().right], [3, 0]);
  assert.equal(restored.getState().events[0].quantity, 3);
  assert.equal(restored.getState().logs[0].message, 'ROSA VERMELHA → ESQUERDA +3');
  assert.equal(restored.hasProcessedGift('msg-1'), true);
});