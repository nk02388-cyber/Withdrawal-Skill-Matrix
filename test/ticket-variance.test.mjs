import {followupComplete} from '../management.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {pickVarianceText} from '../picking.mjs';
import {ticketDocumentCount} from '../withdrawal-documents.mjs';
import {workBreakdown,minutesText,pickCompleteness,reasonLabels} from '../operations.mjs';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
test('print report distinguishes net shift time and incomplete actual picking',()=>{
  let result='';
  const node={set innerHTML(value){result=value;}};
  const render=runInNewContext(source.slice(source.indexOf('function populateReport('),source.indexOf('function printReport('))+';populateReport',{
    state:{management:{cases:[]}},followupComplete,$:()=>node,esc:v=>String(v??''),qtyText:v=>String(v),fmtReport:()=> 'วันทดสอบ',nameFor:()=> 'พนักงาน',jobFor:()=> 'Job',
    statusLabels:{done:'เสร็จแล้ว'},reportFiltersText:()=> 'วันที่จบงาน',ticketDocumentCount,totalDocuments:list=>list.reduce((n,t)=>n+ticketDocumentCount(t),0),
    workBreakdown,minutesText,pickCompleteness,pickVarianceText,documentSummary:()=> 'ใบ A 1,000 FG · ใบ B 2,000 FG',
  });
  render([{ticket_no:'A,B',status:'done',materials:[{pk_code:'QA',required_qty:3000,unit:'ชิ้น'}],started_at:'2026-09-30T11:00:00+07:00',ended_at:'2026-09-30T14:00:00+07:00',pause_intervals:[{start:'2026-09-30T11:30:00+07:00',end:'2026-09-30T13:30:00+07:00'}]}],{});
  assert.match(result,/1 ชม\. 0 นาที/);
  assert.match(result,/ข้อมูลเบิกจริงไม่ครบ 0\/1 รายการ/);
  assert.match(result,/ใบ A 1,000 FG/);
  assert.match(result,/วันที่จบงาน/);
});
const table=source.slice(source.indexOf('function materialTable('),source.indexOf('function renderBomOptions('));
const renderer=source.slice(source.indexOf('function ticketHtml('),source.indexOf('function ticketFilters('));
const expandedTickets=new Set();
const html=runInNewContext(table+renderer+';ticketHtml',{
  expandedTickets,state:{management:{cases:[]}},followupComplete,
  ticketDocumentCount,
  workBreakdown,minutesText,pickCompleteness,reasonLabels,documentSummary:()=>'',
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
