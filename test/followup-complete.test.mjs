import test from 'node:test';import assert from 'node:assert/strict';
import {followupComplete,varianceRows} from '../management.mjs';
test('fulfilled badge requires all current exceptions resolved on a closed ticket',()=>{
 const t={id:'a',status:'partial',materials:[{pk_code:'A',required_qty:10,actual_qty:8,confirmed_at:'now'},{pk_code:'B',required_qty:10,actual_qty:12,confirmed_at:'now'}]};
 const cases=varianceRows([t]).map(r=>({ticket_id:t.id,line_index:r.index,fingerprint:r.fingerprint,status:'resolved'}));
 assert.equal(followupComplete(t,cases.slice(0,1)),false);
 assert.equal(followupComplete(t,cases),true);
 assert.equal(t.materials[0].actual_qty,8);assert.equal(t.status,'partial');
 cases[0].status='following';assert.equal(followupComplete(t,cases),false);cases[0].status='resolved';
 t.materials[0].actual_qty=7;assert.equal(followupComplete(t,cases),false);t.materials[0].actual_qty=8;
 for(const status of ['active','paused','cancelled','queued'])assert.equal(followupComplete({...t,status},cases),false);
 assert.equal(followupComplete({...t,deleted_at:'now'},cases),false);
 assert.equal(followupComplete({...t,materials:[...t.materials,{required_qty:1}]},cases),false);
});
