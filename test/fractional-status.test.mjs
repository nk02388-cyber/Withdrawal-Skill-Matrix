import test from 'node:test';import assert from 'node:assert/strict';
import {fractionalVariance,significantShortage} from '../pick-tolerance.mjs';
import {followupComplete,varianceRows} from '../management.mjs';
import {automaticPickCloseStatus,pickError} from '../picking.mjs';
test('fractional tolerance is at most one saved unit, with four-decimal boundaries',()=>{
 for(const [required,actual] of [[800.16,800],[49.92,50],[10,9.0001],[10,9],[10,11]])assert.equal(fractionalVariance(required,actual),true);
 for(const [required,actual] of [[10,8.9999],[10,11.0001],[10,8.8],[10,10]])assert.equal(fractionalVariance(required,actual),false);
 assert.equal(significantShortage(10,9),false);assert.equal(significantShortage(10,9.0001),false);
});
test('fractional shortage and excess display fulfilled without follow-up, retaining recorded quantities',()=>{
 const t={id:'a',status:'partial',materials:[{pk_code:'A',required_qty:800.16,actual_qty:800,confirmed_at:'now'},{pk_code:'B',required_qty:49.92,actual_qty:50,confirmed_at:'now'}]};
 assert.equal(followupComplete(t),true);assert.equal(varianceRows([t]).length,0);
 const picks=t.materials.map(l=>({actual_qty:l.actual_qty,short_reason:'ปัดเศษ'}));assert.equal(automaticPickCloseStatus(t.materials,picks,'partial'),'done');assert.equal(pickError(t.materials,picks,'done'),'');
 t.materials[0].actual_qty=799.1599;assert.equal(followupComplete(t),false);assert.equal(automaticPickCloseStatus(t.materials,t.materials,'done'),'partial');
 t.materials[0].actual_qty=800;t.materials[1].confirmed_at=null;assert.equal(followupComplete(t),false);
});
