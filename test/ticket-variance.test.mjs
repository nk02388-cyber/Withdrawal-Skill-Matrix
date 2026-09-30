import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {pickVarianceText} from '../picking.mjs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const table=source.slice(source.indexOf('function materialTable('),source.indexOf('function renderBomOptions('));
const renderer=source.slice(source.indexOf('function ticketHtml('),source.indexOf('function ticketFilters('));
const expandedTickets=new Set();
const html=runInNewContext(table+renderer+';ticketHtml',{
  expandedTickets,
  esc:v=>String(v??'').replace(/</g,'&lt;'),qtyText:v=>String(v),pickVarianceText,
  statusLabels:{done:'เสร็จแล้ว'},operator:()=>false,supervisor:()=>false,
  workMinutes:()=>null,jobFor:()=> 'Job',nameFor:()=> 'พนักงาน',fmt:()=> '—',
});
test('opened materials survive refresh, filtering and explicit collapse',()=>{
  let details=[{dataset:{materialTicket:'a'},open:true},{dataset:{materialTicket:'b'},open:false}];
  const remember=runInNewContext(source.slice(source.indexOf('function rememberOpenMaterials('),source.indexOf('function renderTickets('))+';rememberOpenMaterials',{
    expandedTickets,$:()=>({querySelectorAll:()=>details}),
  });
  const ticket={id:'a',status:'done',materials:[line('FULL',10)]};
  remember();
  assert.match(html(ticket),/data-material-ticket="a" open>/);
  assert.doesNotMatch(html({...ticket,id:'b'}),/data-material-ticket="b" open>/);
  details=[];remember();
  assert.match(html(ticket),/data-material-ticket="a" open>/);
  details=[{dataset:{materialTicket:'a'},open:false}];remember();
  assert.doesNotMatch(html(ticket),/data-material-ticket="a" open>/);
  expandedTickets.clear();
});
const line=(pk_code,actual_qty,confirmed_at='now')=>({pk_code,pk_name:'วัสดุ',required_qty:10,actual_qty,confirmed_at,unit:'ชิ้น',short_reason:'<เหตุผล>'});
test('confirmed short and over items are visible outside collapsed material details',()=>{
  const result=html({status:'done',materials:[line('SHORT',0),line('OVER',12),line('FULL',10),line('UNKNOWN',0,null)]});
  const visible=result.match(/<section class="ticket-variance"[\s\S]*?<\/section>/)?.[0];
  assert.ok(visible);
  assert.match(visible,/2 รายการ/);
  assert.match(visible,/SHORT/);assert.match(visible,/ขาด 10 ชิ้น/);
  assert.match(visible,/OVER/);assert.match(visible,/เกิน 2 ชิ้น/);
  assert.match(visible,/&lt;เหตุผล>/);
  assert.doesNotMatch(visible,/FULL|UNKNOWN|<details/);
});
test('fully picked and unconfirmed tickets show no variance section',()=>{
  for(const materials of [undefined,[],[line('FULL',10)],[line('UNKNOWN',0,null)]]){
    assert.doesNotMatch(html({status:'done',materials}),/ticket-variance/);
  }
});
