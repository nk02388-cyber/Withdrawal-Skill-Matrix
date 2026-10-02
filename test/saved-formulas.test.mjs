import test from 'node:test';
import assert from 'node:assert/strict';
import {formulaDraft,mergeFormulas} from '../saved-formulas.mjs';
const bom={pk_code:'31-01',pk_name:'ขวด',unit:'ใบ',qty_per_unit:1};
const extra={pk_code:'film-01',pk_name:'ฟิล์ม',unit:'กก.',required_qty:2.88};
test('save BOM plus extras as proportional planned quantities, without actual issue data',()=>{
 const draft=formulaDraft({fg_code:'21-01',fg_name:'สูตร A',base_qty:2000,bomLines:[{...bom,actual_qty:99,short_reason:'test'}],stockLines:[extra]});
 assert.equal(draft.lines[1].qty_per_unit,0.00144);
 assert.equal(Math.round(draft.lines[1].qty_per_unit*4000*10000)/10000,5.76);
 assert.equal(draft.lines[1].source,'bom');
 assert.equal(draft.lines[0].actual_qty,undefined);
 assert.equal(draft.lines[0].short_reason,undefined);
});
test('new formula can be built using stock lines alone',()=>{
 const draft=formulaDraft({fg_code:'new/01',fg_name:'ผลิตใหม่',base_qty:100,stockLines:[extra]});
 assert.equal(draft.fg_code,'NEW/01');assert.equal(draft.lines[0].qty_per_unit,0.0288);
});
test('reject duplicate materials ignoring case and invalid production base',()=>{
 assert.throws(()=>formulaDraft({fg_code:'21-01',fg_name:'สูตร',base_qty:100,bomLines:[bom],stockLines:[{...extra,pk_code:'31-01'}]}),/ซ้ำ/);
 for(const base_qty of [0,-1,NaN,Infinity,1000001,0.0001])assert.throws(()=>formulaDraft({fg_code:'21',fg_name:'สูตร',base_qty,bomLines:[bom]}));
});
test('reject missing units, invalid rates and more than 30 materials',()=>{
 const base={fg_code:'21',fg_name:'สูตร',base_qty:100};
 for(const line of [{...bom,unit:''},{...bom,qty_per_unit:Infinity},{...bom,qty_per_unit:0}])assert.throws(()=>formulaDraft({...base,bomLines:[line]}));
 assert.throws(()=>formulaDraft({...base,bomLines:Array.from({length:31},(_,i)=>({...bom,pk_code:`M-${i}`}))}));
});
test('saved formulas replace PK search entries for the same FG and carry their own hash',()=>{
 const pk={fg_code:'21',fg_name:'เดิม',lines:[bom]},saved={fg_code:'21',fg_name:'ใหม่',source_sha256:'a'.repeat(64),lines:[extra]};
 const result=mergeFormulas([pk],[saved]);
 assert.equal(result.length,1);assert.equal(result[0].origin,'saved');assert.equal(result[0].source_sha256,saved.source_sha256);
 assert.equal(pk.fg_name,'เดิม');assert.equal(mergeFormulas([], [saved]).length,1);
});
