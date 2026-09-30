import test from 'node:test';import assert from 'node:assert/strict';
import {workBreakdown,pickCompleteness,operationalPerformance,documentsError} from '../operations.mjs';
import {filterTickets} from '../ticket-report.mjs';
const th=t=>'2026-09-30T'+t+':00+07:00';
const ticket=(start,end,pauses=[])=>({started_at:th(start),ended_at:th(end),pause_intervals:pauses.map(([a,b])=>({start:th(a),end:b?th(b):null}))});
test('net work subtracts pauses without double subtracting lunch',()=>{
  assert.deepEqual(workBreakdown(ticket('11:00','14:00',[['11:30','13:30']])),{activeMinutes:60,waitingMinutes:60,totalMinutes:180,outsideMinutes:60});
  assert.equal(workBreakdown(ticket('09:00','11:00',[['09:30','10:00']])).activeMinutes,90);
});
test('overlapping pauses merge and edited times clip pauses',()=>{
  assert.equal(workBreakdown(ticket('09:00','11:00',[['08:00','10:00'],['09:30','10:30']])).waitingMinutes,90);
  assert.equal(workBreakdown(ticket('09:00','11:00',[['08:00','10:00'],['09:30','10:30']])).activeMinutes,30);
});
test('overnight and out-of-shift intervals do not count as active work',()=>{
  const result=workBreakdown({started_at:'2026-09-30T16:00:00+07:00',ended_at:'2026-10-01T09:00:00+07:00'});
  assert.equal(result.activeMinutes,120);assert.equal(result.totalMinutes,1020);assert.equal(result.outsideMinutes,900);
  assert.equal(workBreakdown(ticket('07:00','18:00')).activeMinutes,480);
  assert.equal(workBreakdown(ticket('01:00','03:00')).activeMinutes,0);
});
test('ongoing pauses use supplied clock and invalid times stay unknown',()=>{
  assert.equal(workBreakdown({started_at:th('09:00'),pause_intervals:[{start:th('09:30'),end:null}]},Date.parse(th('10:00'))).activeMinutes,30);
  assert.equal(workBreakdown({started_at:'bad',ended_at:th('10:00')}),null);
  assert.equal(workBreakdown(ticket('10:00','09:00')),null);
});
test('completed legacy work is not assumed to have confirmed picks; zero picks are explicit',()=>{
  assert.equal(pickCompleteness({status:'done',materials:[{required_qty:10}]}).complete,false);
  assert.equal(pickCompleteness({materials:[{actual_qty:0,confirmed_at:'now'}]}).complete,true);
  assert.equal(pickCompleteness({materials:[]}).complete,false);
});
test('standard comparison requires exact job/SKU, complete data and positive net time',()=>{
  const material={required_qty:10,actual_qty:10,confirmed_at:'now'};
  const work={...ticket('09:00','10:00'),status:'done',job_type_id:'job',fg_code:'FG-A',requested_qty:1000,materials:[material]};
  const standards=[{job_type_id:'job',fg_code:'FG-A',setup_minutes:10,minutes_per_line:5,minutes_per_1000_fg:45}];
  assert.equal(operationalPerformance([work],standards).efficiency,100);
  assert.equal(operationalPerformance([{...work,fg_code:'FG-B'}],standards).efficiency,null);
  assert.equal(operationalPerformance([{...work,materials:[{required_qty:10}]}],standards).efficiency,null);
  assert.equal(operationalPerformance([work],[]).efficiency,null);
});
test('stock shortage and approved excess are separate from recorded picking errors',()=>{
  const lines=['stock_shortage','approved_extra','picking_error',null].map(reason_code=>({required_qty:10,actual_qty:9,confirmed_at:'now',reason_code}));
  const quality=operationalPerformance([{status:'partial',materials:lines}],[]);
  assert.equal(quality.pickingErrors,1);assert.equal(quality.reviewNeeded,1);
});
test('per-document production quantities must be complete and match total',()=>{
  const rows=[{number:'A',quantity:1000},{number:'B',quantity:2000}];
  assert.equal(documentsError(rows,3000),'');assert.ok(documentsError(rows,4000));
  assert.ok(documentsError([{number:'A',quantity:null}],3000));
  assert.ok(documentsError([{number:'A',quantity:1},{number:'a',quantity:2}],3));
  assert.equal(documentsError([{number:'A',quantity:null}],null,false),'');
});
test('date basis includes yesterday-created work completed today; no end date is excluded',()=>{
  const list=[{ticket_no:'A',created_at:'2026-09-29T08:00:00+07:00',ended_at:th('10:00')},{ticket_no:'B',created_at:th('08:00'),ended_at:null}];
  assert.deepEqual(filterTickets(list,{dateBasis:'ended_at',dateFrom:'2026-09-30',dateTo:'2026-09-30'}).map(t=>t.ticket_no),['A']);
  assert.deepEqual(filterTickets(list,{dateBasis:'created_at',dateFrom:'2026-09-30'}).map(t=>t.ticket_no),['B']);
});
test('completeness filters preserve nonmaterial work separately',()=>{
  const list=[{ticket_no:'legacy',materials:[{}]},{ticket_no:'complete',materials:[{actual_qty:0,confirmed_at:'now',required_qty:10}]},{ticket_no:'training',materials:[]}];
  assert.deepEqual(filterTickets(list,{completeness:'incomplete'}).map(t=>t.ticket_no),['legacy']);
  assert.deepEqual(filterTickets(list,{completeness:'variance'}).map(t=>t.ticket_no),['complete']);
});
