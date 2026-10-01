import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPickActual,automaticPickCloseStatus,pickError} from '../picking.mjs';
test('autofill keeps confirmed actuals including zero; new lines use required quantity',()=>{
 assert.equal(defaultPickActual({required_qty:49.92}),49.92);
 assert.equal(defaultPickActual({required_qty:10,actual_qty:0,confirmed_at:'now'}),0);
 assert.equal(defaultPickActual({required_qty:10,actual_qty:12,confirmed_at:'now'}),12);
 assert.equal(defaultPickActual({required_qty:10,actual_qty:7}),10);
});
test('automatic closure handles mixed shortages and excess, independent of entry button',()=>{
 const m=[{required_qty:49.92},{required_qty:2.88}],p=[{actual_qty:50,short_reason:'ปัดเศษ'},{actual_qty:2.88}];
 assert.equal(automaticPickCloseStatus(m,p,'partial'),'done');
 assert.equal(pickError(m,p,automaticPickCloseStatus(m,p,'partial')),'');
 p[1]={actual_qty:1.88,short_reason:'ของขาด'};
 assert.equal(automaticPickCloseStatus(m,p,'done'),'partial');
 assert.equal(pickError(m,p,automaticPickCloseStatus(m,p,'done')),'');
 assert.equal(automaticPickCloseStatus(m,p,null),null);
 assert.ok(pickError(m,[{actual_qty:null},p[1]],'partial'));
});
