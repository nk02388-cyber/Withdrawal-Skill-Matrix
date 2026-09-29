import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSkill, personPerformance } from '../skill-metrics.mjs';

test('automatic skill advances only on completed jobs', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 11, 12].map(automaticSkill), [0, 1, 1, 2, 2, 3, 3, 4]);
});

test('person performance excludes open and cancelled jobs from completion rate', () => {
  const tickets = [
    { assignee_id: 'a', status: 'done', started_at: '2026-09-29T00:00:00Z', ended_at: '2026-09-29T01:00:00Z' },
    { assignee_id: 'a', status: 'done', started_at: '2026-09-29T00:00:00Z', ended_at: '2026-09-29T03:00:00Z' },
    { assignee_id: 'a', status: 'partial' },
    { assignee_id: 'a', status: 'queued' },
    { assignee_id: 'a', status: 'cancelled' },
    { assignee_id: 'b', status: 'done' },
  ];
  assert.deepEqual(personPerformance('a', tickets), {
    total: 5, done: 2, partial: 1, open: 1, completionRate: 67, medianMinutes: 120,
  });
  assert.deepEqual(personPerformance('b', tickets), {
    total: 1, done: 1, partial: 0, open: 0, completionRate: 100, medianMinutes: null,
  });
  assert.equal(personPerformance('c', tickets).completionRate, null);
});
