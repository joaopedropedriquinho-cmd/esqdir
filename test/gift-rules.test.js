import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGift, createGiftHandler } from '../lib/gift-rules.js';

test('classifies explicit rose names and configured real gift IDs', () => {
  assert.equal(classifyGift({ name: 'Rose' }), 'left');
  assert.equal(classifyGift({ name: 'Rosa vermelha' }), 'left');
  assert.equal(classifyGift({ name: 'White Rose' }), 'right');
  assert.equal(classifyGift({ name: 'Rosa branca' }), 'right');
  assert.equal(classifyGift({ name: 'Gift', id: 'red-verified', redGiftIds: new Set(['red-verified']) }), 'left');
  assert.equal(classifyGift({ name: 'Gift', id: 'white-verified', whiteGiftIds: new Set(['white-verified']) }), 'right');
  assert.equal(classifyGift({ name: 'Heart' }), null);
});

test('scores only completed gift streaks, honors quantity, and ignores duplicate IDs', () => {
  const processed = new Set();
  const events = [];
  const logs = [];
  const state = { left: 0, right: 0 };
  const store = {
    hasProcessedGift: id => processed.has(id),
    markGiftProcessed: id => processed.add(id),
    addGift: event => {
      state[event.team] += event.quantity;
      events.push(event);
      return event;
    },
    addLog: message => logs.push(message)
  };
  const handle = createGiftHandler({ store, log: () => {}, onUpdate: () => {}, redGiftIds: new Set(), whiteGiftIds: new Set() });

  assert.equal(handle({ giftDetails: { giftName: 'Rose' }, giftType: 1, repeatCount: 2, repeatEnd: false }).reason, 'streak-in-progress');
  assert.equal(handle({ giftDetails: { giftName: 'Rose' }, giftType: 1, repeatCount: 3, repeatEnd: true, msgId: 'gift-1', user: { uniqueId: 'ana' } }).processed, true);
  assert.equal(handle({ giftDetails: { giftName: 'Rose' }, giftType: 1, repeatCount: 3, repeatEnd: true, msgId: 'gift-1' }).reason, 'duplicate');
  assert.equal(handle({ giftDetails: { giftName: 'White Rose' }, giftType: 0, repeatCount: 2, msgId: 'gift-2' }).processed, true);
  assert.equal(handle({ giftDetails: { giftName: 'Heart' }, giftType: 0, repeatCount: 1 }).reason, 'unmapped-gift');

  assert.deepEqual(state, { left: 3, right: 2 });
  assert.equal(events.length, 2);
  assert.deepEqual(logs, ['ROSA VERMELHA → ESQUERDA +3', 'ROSA BRANCA → DIREITA +2']);
});