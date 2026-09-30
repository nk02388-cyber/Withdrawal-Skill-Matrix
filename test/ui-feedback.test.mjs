import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {convertPickMode} from '../picking.mjs';
import {createSaveGate,saveErrorText} from '../ui-feedback.mjs';

test('changing quantity mode preserves actual quantities and clears incompatible modes',()=>{
  assert.equal(convertPickMode(100,'95','actual','short'),'5');
  assert.equal(convertPickMode(100,'5','short','actual'),'95');
  assert.equal(convertPickMode(100,'105','actual','over'),'5');
  assert.equal(convertPickMode(100,'5','over','actual'),'105');
  assert.equal(convertPickMode(100,'95','actual','over'),'');
  assert.equal(convertPickMode(100,'105','actual','short'),'');
  assert.equal(convertPickMode(100,'','actual','short'),'');
  assert.equal(convertPickMode(.8888,'.8889','actual','over'),'0.0001');
  assert.equal(convertPickMode(100,'bad','actual','short'),'');
});
test('duplicate saves are blocked while pending and retry works after rejection',async()=>{
  const gate=createSaveGate();let release,calls=0;
  const first=gate('ticket',()=>{calls++;return new Promise(resolve=>release=resolve);});
  assert.equal(await gate('ticket',()=>{calls++;return true;}),false);
  assert.equal(calls,1);
  assert.equal(await gate('other',async()=>true),true);
  release(true);assert.equal(await first,true);
  await assert.rejects(gate('ticket',async()=>{throw Error('network');}));
  assert.equal(await gate('ticket',async()=>true),true);
});
test('save errors use actionable Thai and preserve Thai validation messages',()=>{
  assert.match(saveErrorText({code:'23505',message:'duplicate key'}),/เลขที่ใบเบิก/);
  assert.match(saveErrorText({message:'Supervisor access required'}),/สิทธิ์/);
  assert.match(saveErrorText(Error('Failed to fetch')),/อินเทอร์เน็ต/);
  assert.equal(saveErrorText({message:'กรุณากลับมาทำงานต่อก่อนจบงาน'}),'กรุณากลับมาทำงานต่อก่อนจบงาน');
  assert.doesNotMatch(saveErrorText(Error('private internal database detail')),/private|database/);
});
test('unchanged filter options are not replaced during synchronization',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const update=runInNewContext(source.slice(source.indexOf('function setSelectOptions('),source.indexOf('function renderTicketFilterOptions('))+';setSelectOptions');
  let writes=0;const select={dataset:{},set innerHTML(value){writes++;this.html=value;}};
  update(select,'<option>A</option>');update(select,'<option>A</option>');
  assert.equal(writes,1);
  update(select,'<option>B</option>');assert.equal(writes,2);
});
