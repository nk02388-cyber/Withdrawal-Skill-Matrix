import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticSkill, completedJobWorkload, personPerformance } from '../skill-metrics.mjs';

test('automatic skill advances only on completed jobs', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 11, 12].map(automaticSkill), [0, 1, 1, 2, 2, 3, 3, 4]);
});

test('completed workload counts material rows within each person and job, excluding partial and open tickets', () => {
  const tickets = [
    {assignee_id:'a',job_type_id:'pick',status:'done',materials:[{pk_code:'1'},{pk_code:'2'}]},
    {assignee_id:'a',job_type_id:'pick',status:'done',materials:[{pk_code:'1'}]},
    {assignee_id:'a',job_type_id:'pick',status:'partial',materials:[{pk_code:'3'},{pk_code:'4'}]},
    {assignee_id:'a',job_type_id:'pack',status:'done',materials:[{pk_code:'5'}]},
    {assignee_id:'b',job_type_id:'pick',status:'done',materials:[{pk_code:'6'}]},
    {assignee_id:'a',job_type_id:'pick',status:'queued',materials:[{pk_code:'7'}]},
  ];
  assert.deepEqual(completedJobWorkload('a','pick',tickets),{tickets:2,materialLines:3});
  assert.deepEqual(completedJobWorkload('a','pack',tickets),{tickets:1,materialLines:1});
  assert.deepEqual(completedJobWorkload('c','pick',tickets),{tickets:0,materialLines:0});
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
    total: 5, done: 2, partial: 1, open: 1, completionRate: 67, medianMinutes: 60,
  });
  assert.deepEqual(personPerformance('b', tickets), {
    total: 1, done: 1, partial: 0, open: 0, completionRate: 100, medianMinutes: null,
  });
  assert.equal(personPerformance('c', tickets).completionRate, null);
});
