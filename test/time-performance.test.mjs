import test from 'node:test';
import assert from 'node:assert/strict';
import {withdrawalTimePerformance} from '../time-performance.mjs';
const task=(no,start,end,status='done')=>({ticket_no:no,status,materials:[{}],started_at:`2026-09-30T${start}:00+07:00`,ended_at:`2026-09-30T${end}:00+07:00`});
test('38 minutes per document: grouped documents share one duration',()=>{
  const result=withdrawalTimePerformance([task('PK1, PK2','09:00','10:16')]);
  assert.deepEqual(result,{jobs:1,documents:2,actualMinutes:76,expectedMinutes:76,excluded:0,efficiency:100});
});
test('time performance is a ratio of totals, including closed partial jobs',()=>{
  const result=withdrawalTimePerformance([task('PK1','09:00','09:19'),task('PK2','09:00','09:57','partial')]);
  assert.equal(result.efficiency,100); // (38+38)/(19+57), not average of individual percentages.
  assert.equal(result.jobs,2);
});
test('lunch, shift boundaries and pauses are excluded from timed picking',()=>{
  const t=task('PK1','11:30','13:30');t.pause_intervals=[{start:'2026-09-30T13:00:00+07:00',end:'2026-09-30T13:22:00+07:00'}];
  assert.equal(withdrawalTimePerformance([t]).actualMinutes,38);
  assert.equal(withdrawalTimePerformance([t]).efficiency,100);
});
test('open, cancelled, deleted and training work do not count; invalid and zero times stay unknown',()=>{
  const base=task('PK1','09:00','09:38');
  const result=withdrawalTimePerformance([{...base,status:'active'},{...base,status:'cancelled'},{...base,deleted_at:'2026-09-30'},{...base,materials:[]},{...base,started_at:null},task('PK2','09:00','09:00')]);
  assert.equal(result.efficiency,null);assert.equal(result.documents,0);assert.equal(result.excluded,2);
});
test('percentages above 200 remain actual values, not a capped score',()=>{
  assert.equal(withdrawalTimePerformance([task('PK1','09:00','09:10')]).efficiency,380);
});
