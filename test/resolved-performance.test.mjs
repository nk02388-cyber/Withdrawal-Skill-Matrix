import test from 'node:test';import assert from 'node:assert/strict';
import {reportingTickets,varianceRows} from '../management.mjs';import {personPerformance} from '../skill-metrics.mjs';
test('resolved shortages count as completed in performance without rewriting stored picks',()=>{
 const t={id:'a',assignee_id:'p',status:'partial',materials:[{pk_code:'A',required_qty:3200,actual_qty:0,confirmed_at:'now'}]};
 const row=varianceRows([t])[0],cases=[{ticket_id:'a',line_index:0,fingerprint:row.fingerprint,status:'resolved'}];
 const reported=reportingTickets([t],cases),p=personPerformance('p',reported);
 assert.equal(p.partial,0);assert.equal(p.done,1);assert.equal(p.completionRate,100);
 assert.equal(reported[0].materials[0].actual_qty,0);assert.equal(t.status,'partial');
 cases[0].status='open';assert.equal(personPerformance('p',reportingTickets([t],cases)).partial,1);
 cases[0].status='resolved';t.materials[0].confirmed_at='changed';assert.equal(personPerformance('p',reportingTickets([t],cases)).partial,1);
});
