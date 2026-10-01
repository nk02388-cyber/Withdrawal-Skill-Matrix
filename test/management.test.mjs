import test from 'node:test';import assert from 'node:assert/strict';
import {defaultSettings,settingsError,varianceRows,safeCsv,planOrder} from '../management.mjs';
import {configureWorkTime,workBreakdown} from '../operations.mjs';
test('variance follow-up reopens when actual quantities or confirmation changes',()=>{
 const t={id:'1',status:'done',materials:[{pk_code:'A',required_qty:10,actual_qty:8,confirmed_at:'2026-10-01T01:00:00Z'},{pk_code:'B',required_qty:5,actual_qty:6,confirmed_at:'2026-10-01T01:00:00Z'},{pk_code:'C',required_qty:5}]};
 let rows=varianceRows([t]);assert.deepEqual(rows.map(r=>r.delta),[-2,1]);const saved={ticket_id:'1',line_index:0,fingerprint:rows[0].fingerprint,status:'resolved'};
 assert.equal(varianceRows([t],[saved])[0].status,'resolved');t.materials[0].actual_qty=7;assert.equal(varianceRows([t],[saved])[0].status,'open');assert.equal(varianceRows([{...t,deleted_at:'x'}]).length,0);
});
test('settings reject reversed shifts and impossible holiday dates',()=>{
 assert.equal(settingsError(defaultSettings),'');assert.ok(settingsError({...defaultSettings,start:'18:00'}));assert.ok(settingsError({...defaultSettings,holidays:['2026-02-30']}));
});
test('configured shifts and holidays affect net time, then reset defaults',()=>{
 const t={started_at:'2026-10-01T08:00:00+07:00',ended_at:'2026-10-01T17:00:00+07:00'};
 try{configureWorkTime({...defaultSettings,holidays:['2026-10-01']});assert.equal(workBreakdown(t).activeMinutes,0);configureWorkTime({...defaultSettings,start:'09:00'});assert.equal(workBreakdown(t).activeMinutes,420);}finally{configureWorkTime(defaultSettings);}
});
test('CSV protects spreadsheet formulas and preserves Thai and quoted commas',()=>{const csv=safeCsv([['=HYPERLINK("x")','ไทย,ดี']]);assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('"ไทย,ดี"'));});
test('planner orders urgent work then due time without mutating input',()=>{const a=[{priority:'normal'},{priority:'urgent',due_at:'2026-10-02'},{priority:'urgent',due_at:'2026-10-01'}];assert.equal(planOrder(a)[0].due_at,'2026-10-01');assert.equal(a[0].priority,'normal');});
