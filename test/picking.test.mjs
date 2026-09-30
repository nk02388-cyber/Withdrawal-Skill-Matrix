import test from 'node:test';
import assert from 'node:assert/strict';
import {pickError,confirmedPickSummary} from '../picking.mjs';
import {presetDates} from '../dashboard-filters.mjs';
import {filterTickets} from '../ticket-report.mjs';
test('picks require explicit quantities, valid bounds and a shortage reason',()=>{
  const materials=[{required_qty:10},{required_qty:0.8888}];
  for(const value of [null,undefined,NaN,-1,11,0.12345])assert.ok(pickError(materials,[{actual_qty:value},{actual_qty:0.8888}]));
  assert.ok(pickError(materials,[{actual_qty:8},{actual_qty:0.8888}]));
  assert.equal(pickError(materials,[{actual_qty:0,short_reason:'ไม่มีสินค้า'},{actual_qty:0.8888}]),'');
  assert.ok(pickError(materials,[{actual_qty:8,short_reason:'ขาด'},{actual_qty:0.8888}],'done'));
  assert.ok(pickError(materials,[{actual_qty:10},{actual_qty:0.8888}],'partial'));
  assert.equal(pickError(materials,[{actual_qty:10},{actual_qty:0.8888}],'done'),'');
});
test('legacy and zero picks remain distinct, units are not summed',()=>{
  assert.deepEqual(confirmedPickSummary([{materials:[{required_qty:10},{required_qty:10,actual_qty:0,confirmed_at:'now'},{required_qty:2,actual_qty:2,confirmed_at:'now'}]}]),{confirmed:2,picked:1,short:1,unknown:1});
});
test('dashboard presets use Thai calendar dates and Monday start including year boundaries',()=>{
  assert.deepEqual(presetDates('today',new Date('2026-09-29T18:00:00Z')),{dateFrom:'2026-09-30',dateTo:'2026-09-30'});
  assert.deepEqual(presetDates('week',new Date('2027-01-01T00:00:00Z')),{dateFrom:'2026-12-28',dateTo:'2027-01-01'});
  assert.deepEqual(presetDates('month',new Date('2026-09-30T18:00:00Z')),{dateFrom:'2026-10-01',dateTo:'2026-10-01'});
  const tickets=[{created_at:'2026-09-29T17:00:00Z',job_type_id:'A'},{created_at:'2026-09-29T16:59:59Z',job_type_id:'A'},{created_at:'2026-09-30T10:00:00Z',job_type_id:'B'}];
  assert.equal(filterTickets(tickets,{...presetDates('today',new Date('2026-09-30T00:00:00Z')),jobId:'A'}).length,1);
});
