import test from 'node:test';
import assert from 'node:assert/strict';

import { getDayKey, movePastTodosToToday } from '../firefox-extension/lib/store.js';

test('getDayKey uses the local calendar date instead of UTC rollover', () => {
  const date = new Date(2024, 2, 4, 23, 30);
  const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  assert.equal(getDayKey(date), expected);
});

test('movePastTodosToToday advances old day assignments to the current day', () => {
  const groups = [{
    id: 'g1',
    title: 'Notes',
    todos: [
      { id: 'a', text: 'yesterday', day: '2024-03-03' },
      { id: 'b', text: 'today', day: '2024-03-04' },
      { id: 'c', text: 'older', day: '2024-03-01' },
    ],
  }];

  const moved = movePastTodosToToday(groups, '2024-03-04');

  assert.deepEqual(moved, [{
    id: 'g1',
    title: 'Notes',
    todos: [
      { id: 'a', text: 'yesterday', day: '2024-03-04' },
      { id: 'b', text: 'today', day: '2024-03-04' },
      { id: 'c', text: 'older', day: '2024-03-04' },
    ],
  }]);
});
