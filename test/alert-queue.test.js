import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlertQueue } from '../public/alert-queue.js';

test('queues consecutive rose alerts without overlap and observes visible and exit durations', () => {
  const scheduled = [];
  const shown = [];
  const hidden = [];
  const cleared = [];
  const queue = createAlertQueue({
    show: event => shown.push(event),
    hide: () => hidden.push(shown.at(-1)),
    clear: () => cleared.push(shown.at(-1)),
    displayMs: 2000,
    exitMs: 380,
    schedule: (callback, delay) => scheduled.push({ callback, delay })
  });
  const redRose = { team: 'left', username: '@ana' };
  const whiteRose = { team: 'right', username: '@bia' };

  queue.enqueue(redRose);
  queue.enqueue(whiteRose);
  assert.deepEqual(shown, [redRose]);
  assert.equal(queue.pending, 1);
  assert.equal(scheduled[0].delay, 2000);

  scheduled.shift().callback();
  assert.deepEqual(hidden, [redRose]);
  assert.equal(scheduled[0].delay, 380);
  scheduled.shift().callback();

  assert.deepEqual(cleared, [redRose]);
  assert.deepEqual(shown, [redRose, whiteRose]);
  assert.equal(queue.pending, 0);
});