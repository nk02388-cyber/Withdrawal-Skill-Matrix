import test from 'node:test';
import assert from 'node:assert/strict';
import {isWipCode,excludeWipLines,pickingFormulas} from '../material-policy.mjs';
import {formulaDraft,mergeFormulas} from '../saved-formulas.mjs';
test('exclude all codes beginning with 5, retaining packaging and shared materials',()=>{
 const codes=['51-0021-001/1',' 5-ABC','31-0021-02-56','313-2-0701-5801','SSHF-051'];
 assert.deepEqual(codes.map(isWipCode),[true,true,false,false,false]);
 const lines=codes.map(pk_code=>({pk_code}));
 assert.deepEqual(excludeWipLines(lines).map(l=>l.pk_code),codes.slice(2));
 assert.equal(lines.length,5);
});
test('PK and saved formulas both exclude WIP; WIP-only formulas are unavailable',()=>{
 const formulas=[{fg_code:'21-A',lines:[{pk_code:'51-X'},{pk_code:'31-X'}]},{fg_code:'21-B',lines:[{pk_code:'51-Y'}]}];
 assert.equal(pickingFormulas(formulas).length,1);
 assert.deepEqual(mergeFormulas(formulas,formulas)[0].lines,[{pk_code:'31-X'}]);
 assert.equal(formulas[0].lines.length,2);
});
test('saving a formula with a WIP stock line is blocked',()=>{
 assert.throws(()=>formulaDraft({fg_code:'21-A',fg_name:'ผลิต',base_qty:100,stockLines:[{pk_code:'51-X',pk_name:'WIP',unit:'ขวด',required_qty:100}]}),/WIP/);
});
