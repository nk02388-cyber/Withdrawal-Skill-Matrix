import test from 'node:test';
import assert from 'node:assert/strict';
import {pickError,confirmedPickSummary,actualFromInput,pickVarianceText} from '../picking.mjs';
import {presetDates} from '../dashboard-filters.mjs';
import {filterTickets} from '../ticket-report.mjs';
test('picks require explicit quantities, valid bounds and a shortage reason',()=>{
  const materials=[{required_qty:10},{required_qty:0.8888}];
  for(const value of [null,undefined,NaN,-1,12,0.12345])assert.ok(pickError(materials,[{actual_qty:value},{actual_qty:0.8888}]));
  assert.ok(pickError(materials,[{actual_qty:8},{actual_qty:0.8888}]));
  assert.equal(pickError(materials,[{actual_qty:0,short_reason:'ไม่มีสินค้า'},{actual_qty:0.8888}]),'');
  assert.ok(pickError(materials,[{actual_qty:8,short_reason:'ขาด'},{actual_qty:0.8888}],'done'));
  assert.ok(pickError(materials,[{actual_qty:10},{actual_qty:0.8888}],'partial'));
  assert.equal(pickError(materials,[{actual_qty:10},{actual_qty:0.8888}],'done'),'');
});
test('legacy and zero picks remain distinct, units are not summed',()=>{
  assert.deepEqual(confirmedPickSummary([{materials:[{required_qty:10},{required_qty:10,actual_qty:0,confirmed_at:'now'},{required_qty:2,actual_qty:2,confirmed_at:'now'}]}]),{confirmed:2,picked:1,short:1,over:0,unknown:1});
});
test('dashboard presets use Thai calendar dates and Monday start including year boundaries',()=>{
  assert.deepEqual(presetDates('today',new Date('2026-09-29T18:00:00Z')),{dateFrom:'2026-09-30',dateTo:'2026-09-30'});
  assert.deepEqual(presetDates('week',new Date('2027-01-01T00:00:00Z')),{dateFrom:'2026-12-28',dateTo:'2027-01-01'});
  assert.deepEqual(presetDates('month',new Date('2026-09-30T18:00:00Z')),{dateFrom:'2026-10-01',dateTo:'2026-10-01'});
  const tickets=[{created_at:'2026-09-29T17:00:00Z',job_type_id:'A'},{created_at:'2026-09-29T16:59:59Z',job_type_id:'A'},{created_at:'2026-09-30T10:00:00Z',job_type_id:'B'}];
  assert.equal(filterTickets(tickets,{...presetDates('today',new Date('2026-09-30T00:00:00Z')),jobId:'A'}).length,1);
});

test('over picks require reasons and can finish, deficits convert from a direct amount',()=>{const m=[{required_qty:10}];assert.equal(pickError(m,[{actual_qty:12,short_reason:'เบิกเผื่อ'}],'done'),'');assert.ok(pickError(m,[{actual_qty:12}],'done'));assert.ok(pickError(m,[{actual_qty:1000000001,short_reason:'เกิน'}]));assert.equal(actualFromInput(10,2,'short'),8);assert.equal(actualFromInput(10,2,'over'),12);assert.equal(actualFromInput(.8888,.0001,'over'),.8889);assert.ok(Number.isNaN(actualFromInput(10,.12345)));assert.equal(actualFromInput(10,''),null);assert.ok(pickError(m,[{actual_qty:actualFromInput(10,11,'short'),short_reason:'ขาด'}]));assert.equal(pickVarianceText(10,12,'ชิ้น'),'เกิน 2 ชิ้น');assert.equal(pickVarianceText(10,8,'ชิ้น'),'ขาด 2 ชิ้น');assert.equal(pickVarianceText(10,10,'ชิ้น'),'ครบตามใบเบิก');assert.deepEqual(confirmedPickSummary([{materials:[{required_qty:10,actual_qty:12,confirmed_at:'now'}]}]),{confirmed:1,picked:1,short:0,over:1,unknown:0});});
