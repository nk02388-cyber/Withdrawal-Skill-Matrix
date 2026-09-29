import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PK_WMS_URL, PK_WMS_PUBLISHABLE_KEY } from './config.js';
import { filterTickets } from './ticket-report.mjs';
import { automaticSkill, personPerformance } from './skill-metrics.mjs';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = v => v ? new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)) : '—';
const fmtReport = v => v ? new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(v)) : '—';
sessionStorage.removeItem('editCode');
const state = {db:null,role:sessionStorage.getItem('workRole')||'',username:sessionStorage.getItem('workUsername')||'',code:sessionStorage.getItem('workCode')||'',verified:false,people:[],jobs:[],tickets:[],skills:[],bom:null,stock:null,stockLines:[],view:'dashboard'};
const editing = () => state.verified && !!state.code;
const supervisor = () => editing() && state.role==='supervisor';
const operator = () => editing() && state.role==='operator';
const empty = msg => `<div class="empty">${esc(msg)}</div>`;
const nameFor = id => state.people.find(p=>p.id===id)?.display_name||'ไม่พบพนักงาน';
const portraitFiles = {
  'bee9c21d-d1a0-4f7a-8d75-c0cde7aa76e1':'assets/jirathit.jpg',
  'c0da4eaa-ac39-459d-b324-44d6e0e44931':'assets/phurin.jpg',
  '5da3ec7d-24cb-4639-8d8b-cac3a550753a':'assets/somon.jpg',
};
const featuredOrder = ['bee9c21d-d1a0-4f7a-8d75-c0cde7aa76e1','c0da4eaa-ac39-459d-b324-44d6e0e44931','5da3ec7d-24cb-4639-8d8b-cac3a550753a'];
function personPortrait(person, className='person-avatar'){
  const file=portraitFiles[person.id];
  return file?`<img class="${className}" src="${file}" alt="ภาพ ${esc(person.display_name)}" loading="lazy" width="72" height="72">`:`<span class="${className} avatar-fallback" aria-hidden="true">${esc(person.display_name?.slice(0,1)||'?')}</span>`;
}
const jobFor = id => state.jobs.find(j=>j.id===id)?.name||'ไม่พบประเภทงาน';
const qtyText = value => new Intl.NumberFormat('th-TH',{maximumFractionDigits:4}).format(Number(value));
const calcQty = (rate, qty) => Math.round((Number(rate)*qty+Number.EPSILON)*10000)/10000;
const statusLabels={queued:'รอดำเนินการ',active:'กำลังทำ',paused:'พักงาน',done:'เสร็จแล้ว',partial:'เบิกไม่ครบ',cancelled:'ยกเลิก'};
const eventLabels={created:'สร้างใบเบิก',imported:'ข้อมูลก่อนเปิดประวัติ',started:'เริ่มงาน',paused:'พักงาน',resumed:'ทำงานต่อ',completed:'จบงาน',partial:'เบิกไม่ครบ',cancelled:'ยกเลิก',edited:'แก้ไขใบเบิก'};
const eventConfig={pause:{title:'พักงาน',rpc:'pause_ticket_as_operator',required:true,success:'พักงานแล้ว'},resume:{title:'กลับมาทำงานต่อ',rpc:'resume_ticket_as_operator',required:false,success:'กลับมาทำงานแล้ว'},partial:{title:'ปิดงานเป็นเบิกไม่ครบ',rpc:'mark_ticket_partial_as_operator',required:true,success:'ปิดงานเป็นเบิกไม่ครบแล้ว'},cancel:{title:'ยกเลิกใบเบิก',rpc:'cancel_ticket_as_supervisor',required:true,success:'ยกเลิกใบเบิกแล้ว'}};
let pendingEvent=null,editingTicketId=null;
const chosenFormula = () => state.bom?.formulas.find(f=>f.fg_code===$('#bom-select').value);
function materialTable(lines){return `<div class="bom-table-wrap"><table class="bom-table"><thead><tr><th>รหัส PK / วัตถุดิบ</th><th>ที่มา</th><th>จำนวนเบิก</th></tr></thead><tbody>${lines.map(l=>`<tr><td><strong>${esc(l.pk_code)}</strong><small>${esc(l.pk_name)}</small></td><td>${l.source==='stock'?`นอก BOM · Stock ${esc(l.stock_report_date||'')}`:`BOM · ${qtyText(l.qty_per_unit)} ${esc(l.unit)} / FG`}</td><td><strong>${qtyText(l.required_qty)} ${esc(l.unit)}</strong></td></tr>`).join('')}</tbody></table></div>`;}
function renderBomOptions(){
  const term=$('#bom-search').value.trim().toLocaleLowerCase();
  const old=$('#bom-select').value;
  const matches=state.bom.formulas.filter(f=>(`${f.fg_code} ${f.fg_name}`).toLocaleLowerCase().includes(term)).slice(0,50);
  $('#bom-select').innerHTML='<option value="">เลือกสินค้า FG</option>'+matches.map(f=>`<option value="${esc(f.fg_code)}">${esc(f.fg_code)} · ${esc(f.fg_name)}</option>`).join('');
  if(matches.some(f=>f.fg_code===old))$('#bom-select').value=old;
  $('#bom-source').textContent=`สูตรจาก PK WMS · ${state.bom.formulas.length} สินค้า · แสดง ${matches.length} รายการแรก${term?' ที่ตรงกับคำค้น':''} · ไม่รวมยอดสต็อก`;
  renderBomPreview();
}
function renderBomPreview(){
  if(!$('#bom-fields').hidden&& !state.bom){$('#bom-preview').innerHTML=empty('โหลด BOM ไม่สำเร็จ เลือกเบิกเฉพาะรายการ Stock ได้');return;}
  const f=chosenFormula(),qty=Number($('#ticket-form [name="requested_qty"]').value);
  if(!f){$('#bom-preview').innerHTML=empty('เลือกสูตรการผลิตเพื่อดูรายการวัตถุดิบ');return;}
  if(!Number.isFinite(qty)||qty<=0){$('#bom-preview').innerHTML=empty('ใส่จำนวนที่ต้องการผลิตเพื่อคำนวณวัสดุ');return;}
  if(f.lines.some(l=>!Number.isFinite(Number(l.qty_per_unit))||Number(l.qty_per_unit)<=0)){$('#bom-preview').innerHTML=empty('สูตรนี้มีอัตราใช้วัสดุไม่ครบ กรุณาตรวจสูตรใน PK WMS ก่อนสร้างใบเบิก');return;}
  const lines=f.lines.map(l=>({...l,required_qty:calcQty(l.qty_per_unit,qty)}));
  $('#bom-preview').innerHTML=`<div class="bom-summary"><strong>${esc(f.fg_code)} · ${esc(f.fg_name)}</strong><span>จำนวน ${qtyText(qty)} FG · ${lines.length} รายการวัสดุ</span></div>${materialTable(lines)}<p class="hint">จำนวนเบิกคำนวณตาม BOM (4 ตำแหน่ง) กรุณาตรวจสอบหน่วยและจำนวนจริงก่อนเบิก</p>`;
}
const stockMode=()=>document.querySelector('#ticket-form [name="source_mode"]:checked')?.value==='stock';
function setTicketMode(){
  const manual=stockMode();$('#bom-fields').hidden=manual;
  $('#bom-select').required=!manual;
  $('#ticket-form [name="requested_qty"]').required=!manual;
  if(!manual)renderBomPreview();
  renderStockMatch();
}
async function loadStockCatalog(){
  state.stock=null;
  try{
    const response=await fetch(`${PK_WMS_URL}/rest/v1/rpc/get_withdrawal_stock_catalog`,{method:'POST',headers:{apikey:PK_WMS_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:'{}',cache:'no-store'});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(!Number.isInteger(data.snapshot_id)||!Array.isArray(data.items)||!data.items.length)throw Error('ไม่มีรายการ Stock ล่าสุด');
    state.stock={...data,items:data.items.filter(item=>item.code&&item.name&&item.unit&&!item.unit_conflict)};
    $('#stock-source').textContent=`Stock PK WMS ${data.report_date} · บันทึก ${fmt(data.snapshot_saved_at)} · ${state.stock.items.length} รหัส`;
    $('#stock-codes').innerHTML=state.stock.items.map(item=>`<option value="${esc(item.code)}" label="${esc(item.name)}"></option>`).join('');
    renderStockMatch();return true;
  }catch(error){
    $('#stock-source').textContent=`โหลด Stock ล่าสุดไม่สำเร็จ (${error.message}) · ยังเพิ่มรายการนอก BOM ไม่ได้`;
    $('#stock-codes').innerHTML='';renderStockMatch();return false;
  }
}
function currentStockItem(){const code=$('#stock-code').value.trim().toUpperCase();return state.stock?.items.find(item=>item.code===code);}
function renderStockMatch(){
  const input=$('#stock-code'),item=currentStockItem(),code=input.value.trim().toUpperCase();
  const exists=state.stockLines.some(line=>line.pk_code===code);
  const inBom=!stockMode()&&!!chosenFormula()?.lines.some(line=>line.pk_code.toUpperCase()===code);
  $('#stock-match').textContent=!state.stock?'รอเชื่อมต่อ Stock ล่าสุด':!code?'พิมพ์รหัสเพื่อค้นหารายการ':!item?'ไม่พบรหัสนี้ใน Stock ล่าสุด':exists||inBom?'รหัสนี้อยู่ในใบเบิกแล้ว':`${item.name} · หน่วย ${item.unit}`;
  $('#add-stock-line').disabled=!item||exists||inBom;
}
function renderStockLines(){
  $('#stock-lines').innerHTML=state.stockLines.length?`<div class="bom-table-wrap"><table class="bom-table"><thead><tr><th>รหัส / รายการนอก BOM</th><th>จำนวน</th><th></th></tr></thead><tbody>${state.stockLines.map((line,index)=>`<tr><td><strong>${esc(line.pk_code)}</strong><small>${esc(line.pk_name)}</small></td><td>${qtyText(line.required_qty)} ${esc(line.unit)}</td><td><button type="button" class="text-btn" data-remove-stock="${index}" aria-label="ลบ ${esc(line.pk_code)}">ลบ</button></td></tr>`).join('')}</tbody></table></div>`:empty('ยังไม่มีรายการนอก BOM');
  renderStockMatch();
}
async function loadBom(){
  if(state.bom)return true;
  try{
    let response;
    try{response=await fetch('https://raw.githubusercontent.com/nk02388-cyber/Withdrawal-Skill-Matrix/main/pk-bom.json',{cache:'no-cache'});}catch{}
    if(!response?.ok)response=await fetch('./pk-bom.json',{cache:'no-cache'});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(!Array.isArray(data.formulas)||!data.formulas.length||!(/^[0-9a-f]{64}$/.test(data.source_sha256)))throw Error('ข้อมูลสูตรไม่ถูกต้อง');
    state.bom=data;return true;
  }catch(error){notice(`โหลด BOM จาก PK WMS ไม่สำเร็จ: ${error.message}`,true);return false;}
}

function notice(msg,error=false){const el=$('#notice');el.textContent=msg;el.hidden=!msg;el.style.background=error?'#ffece8':'#e2f6f1';el.style.color=error?'#a74436':'#12685b';}
function syncLabel(msg,ok=false){$('#sync-label').textContent=msg;$('.sync-dot').classList.toggle('online',ok);}
function updateMode(){
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!supervisor());
  $('#user-label').textContent=supervisor()?`หัวหน้า · ${state.username}`:operator()?`ผู้ปฏิบัติงาน · ${state.username}`:'โหมดดูข้อมูล';
  $('#edit-btn').textContent=editing()?'ออกจากโหมด':'เข้าสู่โหมดทำงาน';
  if(!supervisor()&&['people','settings'].includes(state.view))showView('dashboard');
  render();
}
function showView(view){state.view=view;if(view!=='tickets')document.body.classList.remove('print-tickets');document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`${view}-view`);document.querySelectorAll('#nav button').forEach(el=>el.classList.toggle('active',el.dataset.view===view));$('#page-title').textContent={dashboard:'ภาพรวมและ Skill Matrix',tickets:'งานเบิกของ',people:'พนักงาน',settings:'ประเภทงานและทักษะ'}[view];}
async function load(silent=false){
  if(!state.db)return;
  syncLabel('กำลังซิงก์…');
  const {data,error}=await state.db.rpc('get_dashboard_state');
  if(error){syncLabel('ซิงก์ไม่สำเร็จ');if(!silent)notice(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`,true);return;}
  state.people=data.people||[];state.jobs=data.jobs||[];state.tickets=data.tickets||[];state.skills=data.skills||[];
  syncLabel(`ซิงก์ล่าสุด ${new Intl.DateTimeFormat('th-TH',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`,true);
  render();
}
function render(){renderDashboard();renderTickets();if(supervisor()){renderPeople();renderSettings();}}
function renderDashboard(){
  const t=state.tickets;
  $('#metrics').innerHTML=[['ใบเบิกทั้งหมด',t.length],['รอดำเนินการ',t.filter(x=>x.status==='queued').length],['กำลังทำ',t.filter(x=>x.status==='active').length],['พักงาน',t.filter(x=>x.status==='paused').length],['เสร็จแล้ว',t.filter(x=>x.status==='done').length],['เบิกไม่ครบ',t.filter(x=>x.status==='partial').length],['ยกเลิก',t.filter(x=>x.status==='cancelled').length]].map(([label,value])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('');
  const people=state.people.filter(p=>p.active).sort((a,b)=>{
    const ai=featuredOrder.indexOf(a.id),bi=featuredOrder.indexOf(b.id);
    return (ai<0?Infinity:ai)-(bi<0?Infinity:bi)||a.display_name.localeCompare(b.display_name,'th');
  }),jobs=state.jobs.filter(j=>j.active);
  $('#performance-list').innerHTML=people.length?people.map(p=>{
    const perf=personPerformance(p.id,t);
    const time=perf.medianMinutes===null?'—':perf.medianMinutes<1?'<1 นาที':perf.medianMinutes<60?`${Math.round(perf.medianMinutes)} นาที`:`${(perf.medianMinutes/60).toFixed(1)} ชม.`;
    return `<article class="performance-card"><div class="performance-person">${personPortrait(p,'performance-avatar')}<div><h4>${esc(p.display_name)}</h4><span>${perf.total} ใบเบิกที่ได้รับ</span></div></div><div class="performance-stats"><div><strong>${perf.done}</strong><span>งานจบ</span></div><div><strong>${perf.partial}</strong><span>เบิกไม่ครบ</span></div><div><strong>${perf.open}</strong><span>รอดำเนินการ/กำลังทำ</span></div><div><strong>${perf.completionRate===null?'—':`${perf.completionRate}%`}</strong><span>อัตราจบงาน</span></div><div><strong>${time}</strong><span>เวลามัธยฐาน</span></div></div></article>`;
  }).join(''):empty('ยังไม่มีพนักงานที่เปิดใช้งาน');
  $('#matrix').innerHTML=!people.length||!jobs.length?empty('ยังไม่มีพนักงานหรือประเภทงาน เข้าสู่โหมดหัวหน้าเพื่อเริ่มบันทึก'):`<table class="matrix"><thead><tr><th>พนักงาน</th>${jobs.map(j=>`<th>${esc(j.name)}</th>`).join('')}</tr></thead><tbody>${people.map(p=>`<tr><td><div class="matrix-person">${personPortrait(p)}<span class="person-name">${esc(p.display_name)}</span></div></td>${jobs.map(j=>{const count=t.filter(x=>x.assignee_id===p.id&&x.job_type_id===j.id&&x.status==='done').length;const level=automaticSkill(count);const assessed=state.skills.find(s=>s.profile_id===p.id&&s.job_type_id===j.id)?.level||0;return `<td><span class="skill-cell"><span class="skill-badge level-${level}" aria-label="Skill อัตโนมัติระดับ ${level}">${level}</span><span class="done-count">${count} งานจบ${assessed?`<br>หัวหน้า ${assessed}`:''}</span></span></td>`}).join('')}</tr>`).join('')}</tbody></table>`;
  const active=t.filter(x=>['active','paused'].includes(x.status)).slice(0,5);$('#active-list').innerHTML=active.length?active.map(ticketHtml).join(''):empty('ยังไม่มีงานที่กำลังทำหรือพักอยู่');
}
function ticketHtml(t){
  const status=statusLabels[t.status]||t.status;
  const button=(action,label,primary=false)=>`<button type="button" class="${primary?'primary':'text-btn'}" data-action="${action}" data-id="${esc(t.id)}">${label}</button>`;
  let actions='';
  if(operator()){
    if(t.status==='queued')actions+=button('start','เริ่มงาน',true);
    if(t.status==='active')actions+=button('pause','พักงาน')+button('partial','เบิกไม่ครบ')+button('finish','จบงาน',true);
    if(t.status==='paused')actions+=button('resume','ทำงานต่อ',true)+button('partial','เบิกไม่ครบ');
  }
  if(supervisor()){
    actions+=button('edit','แก้ไข');
    if(['queued','active','paused'].includes(t.status))actions+=button('cancel','ยกเลิก');
  }
  actions+=button('history','ประวัติ');
  let duration='';if(t.started_at&&t.ended_at){const mins=Math.max(0,Math.round((new Date(t.ended_at)-new Date(t.started_at))/60000));duration=` · ${Math.floor(mins/60)} ชม. ${mins%60} นาที`;}
  const bom=`${t.fg_code?`<div class="ticket-fg"><strong>${esc(t.fg_code)} · ${esc(t.fg_name)}</strong><span>จำนวน ${qtyText(t.requested_qty)} FG</span></div>`:''}${Array.isArray(t.materials)&&t.materials.length?`<details class="ticket-materials"><summary>ดูรายการเบิก ${t.materials.length} รายการ${t.materials.some(line=>line.source==='stock')?' · มีรายการนอก BOM':''}</summary>${materialTable(t.materials)}</details>`:''}`;
  return `<article class="ticket"><div class="ticket-main"><div class="ticket-code">${esc(t.ticket_no)}</div><h4>${esc(jobFor(t.job_type_id))}</h4><div class="ticket-meta">${esc(nameFor(t.assignee_id))} · สร้าง ${fmt(t.created_at)}</div>${bom}${t.description?`<p class="ticket-detail">${esc(t.description)}</p>`:''}${t.status_reason?`<p class="ticket-reason"><strong>เหตุผล:</strong> ${esc(t.status_reason)}</p>`:''}</div><div class="ticket-right"><span class="status ${esc(t.status)}">${status}</span><div class="ticket-time">เริ่ม ${fmt(t.started_at)}<br>จบ ${fmt(t.ended_at)}${duration}</div><div class="ticket-actions">${actions}</div></div></article>`;
}
function ticketFilters(){return {query:$('#ticket-search').value,assigneeId:$('#ticket-person-filter').value,jobId:$('#ticket-job-filter').value,status:$('#ticket-filter').value==='all'?'':$('#ticket-filter').value,dateFrom:$('#ticket-date-from').value,dateTo:$('#ticket-date-to').value};}
function renderTicketFilterOptions(){
  for(const [selector,rows,placeholder,label] of [['#ticket-person-filter',state.people,'ทุกคน','display_name'],['#ticket-job-filter',state.jobs,'ทุก Job','name']]){
    const select=$(selector),previous=select.value;
    select.innerHTML=`<option value="">${placeholder}</option>`+rows.map(row=>`<option value="${esc(row.id)}">${esc(row[label])}</option>`).join('');
    select.value=previous;
  }
}
function selectedTickets(){return filterTickets(state.tickets,ticketFilters());}
function renderTickets(){
  renderTicketFilterOptions();
  const filters=ticketFilters(),invalid=filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo;
  const list=selectedTickets();
  $('#ticket-count').textContent=invalid?'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด':`${list.length} จาก ${state.tickets.length} รายการ`;
  $('#print-report-btn').disabled=!!invalid;
  $('#ticket-list').innerHTML=invalid?empty('กรุณาแก้ไขช่วงวันที่'):list.length?list.map(ticketHtml).join(''):empty('ไม่พบใบเบิกตามตัวกรอง');
}
function reportFiltersText(filters){
  const parts=[];
  if(filters.query.trim())parts.push(`เลขที่ใบเบิก: ${filters.query.trim()}`);
  if(filters.assigneeId)parts.push(`พนักงาน: ${nameFor(filters.assigneeId)}`);
  if(filters.jobId)parts.push(`Job: ${jobFor(filters.jobId)}`);
  if(filters.dateFrom||filters.dateTo)parts.push(`วันที่สร้าง: ${filters.dateFrom||'ทั้งหมด'} ถึง ${filters.dateTo||'ทั้งหมด'}`);
  if(filters.status)parts.push(`สถานะ: ${statusLabels[filters.status]||filters.status}`);
  return parts.length?parts.join(' · '):'ทุกใบเบิก';
}
function populateReport(list,filters){
  const counts={queued:0,active:0,paused:0,done:0,partial:0,cancelled:0};list.forEach(ticket=>{if(ticket.status in counts)counts[ticket.status]++;});
  const rows=list.map((ticket,index)=>{
    const materials=Array.isArray(ticket.materials)&&ticket.materials.length?`<strong>รายการวัสดุ</strong><div>${ticket.materials.map(line=>`<span>${line.source==='stock'?'[นอก BOM] ':''}${esc(line.pk_code)} ${esc(line.pk_name)}: ${qtyText(line.required_qty)} ${esc(line.unit)}</span>`).join('')}</div>`:'';
    const detail=materials||ticket.description||ticket.status_reason?`<tr class="report-materials"><td colspan="9">${materials}${ticket.description?`<p><strong>หมายเหตุ:</strong> ${esc(ticket.description)}</p>`:''}${ticket.status_reason?`<p><strong>เหตุผลสถานะ:</strong> ${esc(ticket.status_reason)}</p>`:''}</td></tr>`:'';
    const status=statusLabels[ticket.status]||ticket.status;
    return `<tbody class="report-ticket"><tr><td>${index+1}</td><td><strong>${esc(ticket.ticket_no)}</strong></td><td>${esc(fmtReport(ticket.created_at))}</td><td>${esc(nameFor(ticket.assignee_id))}</td><td>${esc(jobFor(ticket.job_type_id))}</td><td>${ticket.fg_code?`${esc(ticket.fg_code)}<br>${esc(ticket.fg_name||'')}<br><strong>${qtyText(ticket.requested_qty)} FG</strong>`:'—'}</td><td>${esc(status)}</td><td>${esc(fmtReport(ticket.started_at))}</td><td>${esc(fmtReport(ticket.ended_at))}</td></tr>${detail}</tbody>`;
  }).join('');
  $('#print-report').innerHTML=`<header><img src="assets/pk-no1-logo.png" alt="PK No.1"><div><h1>รายงานงานเบิกของ</h1><p>พิมพ์เมื่อ ${esc(fmtReport(new Date()))} · เวลาไทย (UTC+7)</p></div></header><div class="report-filter-line"><strong>ตัวกรอง:</strong> ${esc(reportFiltersText(filters))}</div><div class="report-summary"><span>ทั้งหมด <strong>${list.length}</strong></span>${Object.entries(counts).map(([key,count])=>`<span>${statusLabels[key]} <strong>${count}</strong></span>`).join('')}</div><table class="report-table"><thead><tr><th>#</th><th>เลขที่ใบเบิก</th><th>วันที่สร้าง</th><th>พนักงาน</th><th>Job</th><th>FG / จำนวน</th><th>สถานะ</th><th>เริ่ม</th><th>สิ้นสุด</th></tr></thead>${rows||'<tbody><tr><td colspan="9">ไม่พบใบเบิกตามตัวกรอง</td></tr></tbody>'}</table><p class="report-note">จำนวนวัสดุคำนวณตาม BOM ที่บันทึกกับใบเบิก ไม่ใช่หลักฐานการตัดสต็อก</p>`;
}
function printReport(){const list=selectedTickets();populateReport(list,ticketFilters());document.body.classList.add('print-tickets');window.print();}
function renderPeople(){$('#people-list').innerHTML=state.people.length?state.people.map(p=>`<div class="person-row"><div class="matrix-person">${personPortrait(p)}<strong>${esc(p.display_name)}</strong></div><div class="person-controls"><label class="hint"><input type="checkbox" data-active="${esc(p.id)}" ${p.active?'checked':''}> เปิดใช้งาน</label></div></div>`).join(''):empty('ยังไม่มีพนักงาน');}
function renderSettings(){const people=state.people.filter(p=>p.active),jobs=state.jobs.filter(j=>j.active);$('#job-list').innerHTML=state.jobs.length?state.jobs.map(j=>`<div class="job-row"><strong>${esc(j.name)}</strong><label class="hint"><input type="checkbox" data-job-active="${esc(j.id)}" ${j.active?'checked':''}> เปิดใช้งาน</label></div>`).join(''):empty('ยังไม่มีประเภทงาน');$('#skill-editor').innerHTML=!people.length||!jobs.length?empty('เพิ่มพนักงานและประเภทงานก่อนกำหนดทักษะ'):`<div class="matrix-wrap"><table class="skill-edit-table"><thead><tr><th>พนักงาน</th><th>Job</th><th>ระดับทักษะ</th></tr></thead><tbody>${people.flatMap(p=>jobs.map(j=>{const level=state.skills.find(s=>s.profile_id===p.id&&s.job_type_id===j.id)?.level||0;return `<tr><td>${esc(p.display_name)}</td><td>${esc(j.name)}</td><td><select data-skill="${esc(p.id)}" data-job="${esc(j.id)}">${['ยังไม่ประเมิน','1 · เริ่มต้น','2 · ทำได้','3 · ชำนาญ','4 · สอนงานได้'].map((label,i)=>`<option value="${i}" ${i===level?'selected':''}>${label}</option>`).join('')}</select></td></tr>`})).join('')}</tbody></table></div>`;}
async function mutate(fn,args,success){const {error}=await state.db.rpc(fn,{p_username:state.username,p_code:state.code,...args});if(error){notice(`บันทึกไม่สำเร็จ: ${error.message}`,true);return false;}notice(success);await load(true);return true;}
function openEvent(kind,ticket){
  pendingEvent={kind,id:ticket.id};const config=eventConfig[kind],form=$('#event-form');
  form.reset();form.elements.reason.required=config.required;
  $('#event-title').textContent=config.title;$('#event-ticket').textContent=`ใบเบิก ${ticket.ticket_no}`;
  $('#event-hint').textContent=kind==='partial'?'ใบเบิกจะปิดเป็นเบิกไม่ครบและบันทึกเวลาสิ้นสุด':kind==='cancel'?'ใบเบิกจะถูกปิดและไม่สามารถเริ่มงานต่อได้':kind==='pause'?'เวลาที่เริ่มงานไว้จะคงเดิม และสามารถกลับมาทำงานต่อได้':'เหตุผลเพิ่มเติม (ถ้ามี)';
  $('#event-dialog').showModal();
}
function openEdit(ticket){
  editingTicketId=ticket.id;const form=$('#ticket-edit-form');form.reset();
  form.elements.ticket_no.value=ticket.ticket_no;
  form.elements.job_type_id.innerHTML=state.jobs.filter(j=>j.active||j.id===ticket.job_type_id).map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');
  form.elements.assignee_id.innerHTML=state.people.filter(p=>p.active||p.id===ticket.assignee_id).map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');
  form.elements.job_type_id.value=ticket.job_type_id;form.elements.assignee_id.value=ticket.assignee_id;
  form.elements.description.value=ticket.description||'';
  form.elements.requested_qty.value=ticket.requested_qty||'';
  form.elements.requested_qty.disabled=!ticket.fg_code;
  $('#ticket-edit-dialog').showModal();
}
function historyChanges(event){
  const before=event.before_state||{},after=event.after_state||{};
  const fields=[['ticket_no','เลขที่ใบเบิก'],['job_type_id','Job'],['assignee_id','พนักงาน'],['description','หมายเหตุ'],['requested_qty','จำนวน FG']];
  const display=(key,value)=>key==='job_type_id'?jobFor(value):key==='assignee_id'?nameFor(value):key==='requested_qty'?qtyText(value):String(value||'—');
  return fields.filter(([key])=>before[key]!==after[key]).map(([key,label])=>`<li><strong>${label}</strong> ${esc(display(key,before[key]))} → ${esc(display(key,after[key]))}</li>`).join('');
}
async function openHistory(ticket){
  $('#history-title').textContent=`ประวัติ ${ticket.ticket_no}`;$('#history-list').innerHTML=empty('กำลังโหลดประวัติ…');$('#history-dialog').showModal();
  const {data,error}=await state.db.rpc('get_ticket_history',{p_ticket_id:ticket.id});
  if(error){$('#history-list').innerHTML=empty(`โหลดประวัติไม่สำเร็จ: ${error.message}`);return;}
  $('#history-list').innerHTML=data?.length?data.map(event=>`<article class="history-event"><div class="history-event-head"><strong>${esc(eventLabels[event.event_type]||event.event_type)}</strong><time>${esc(fmt(event.created_at))}</time></div><div class="history-actor">${esc(event.actor_role==='supervisor'?'หัวหน้า':event.actor_role==='operator'?'ผู้ปฏิบัติงาน':'ระบบ')} · ${esc(event.actor_username)}</div>${event.reason?`<p><strong>เหตุผล:</strong> ${esc(event.reason)}</p>`:''}${event.event_type==='edited'?`<ul>${historyChanges(event)}</ul>`:''}</article>`).join(''):empty('ยังไม่มีประวัติ');
}

document.addEventListener('click',async e=>{
  const removeStock=e.target.closest('[data-remove-stock]');if(removeStock){state.stockLines.splice(Number(removeStock.dataset.removeStock),1);renderStockLines();return;}
  const nav=e.target.closest('#nav button[data-view]');if(nav){showView(nav.dataset.view);return;}
  const action=e.target.closest('button[data-action]');if(action){
    const kind=action.dataset.action,ticket=state.tickets.find(t=>t.id===action.dataset.id);
    if(!ticket)return;
    if(kind==='history'){await openHistory(ticket);return;}
    if(kind==='edit'&&supervisor()){openEdit(ticket);return;}
    if(kind in eventConfig){if((kind==='cancel'&&supervisor())||(kind!=='cancel'&&operator()))openEvent(kind,ticket);return;}
    if(['start','finish'].includes(kind)&&operator()){
      action.disabled=true;
      await mutate(kind==='start'?'start_ticket_as_operator':'finish_ticket_as_operator',{p_ticket_id:ticket.id},kind==='start'?'เริ่มงานแล้ว':'จบงานแล้ว');
      action.disabled=false;
    }
    return;
  }
  if(e.target.closest('[data-close]'))e.target.closest('dialog').close();
});
$('#event-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!pendingEvent)return;
  const {kind,id}=pendingEvent,config=eventConfig[kind],reason=String(new FormData(e.target).get('reason')||'').trim();
  if(config.required&&!reason){notice('กรุณาระบุเหตุผล',true);return;}
  if(await mutate(config.rpc,{p_ticket_id:id,p_reason:reason},config.success)){$('#event-dialog').close();pendingEvent=null;}
});
$('#ticket-edit-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!supervisor()||!editingTicketId)return;
  const f=new FormData(e.target),ticket=state.tickets.find(t=>t.id===editingTicketId);if(!ticket)return;
  const qty=ticket.fg_code?Number(e.target.elements.requested_qty.value):null,reason=String(f.get('reason')||'').trim();
  if(!reason||ticket.fg_code&&(!Number.isFinite(qty)||qty<=0||qty>1000000||Math.round(qty*1000)!==qty*1000)){notice('กรุณาระบุเหตุผลและจำนวน FG ที่ถูกต้อง',true);return;}
  const args={p_ticket_id:editingTicketId,p_ticket_no:String(f.get('ticket_no')).trim(),p_job_type_id:f.get('job_type_id'),p_assignee_id:f.get('assignee_id'),p_description:String(f.get('description')||'').trim(),p_requested_qty:qty,p_reason:reason};
  if(await mutate('edit_ticket_as_supervisor',args,'แก้ไขใบเบิกและบันทึกประวัติแล้ว')){$('#ticket-edit-dialog').close();editingTicketId=null;}
});
function clearRole(){state.role='';state.username='';state.code='';state.verified=false;['workRole','workUsername','workCode'].forEach(key=>sessionStorage.removeItem(key));}
$('#edit-btn').addEventListener('click',()=>{if(editing()){clearRole();updateMode();notice('ออกจากโหมดทำงานแล้ว');}else $('#code-dialog').showModal();});
$('#code-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),role=String(f.get('role')),username=String(f.get('username')).trim(),code=String(f.get('code'));const {data,error}=await state.db.rpc('verify_role_code',{p_role:role,p_username:username,p_code:code});if(error||!data){$('#code-message').textContent='ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';return;}state.role=role;state.username=username;state.code=code;state.verified=true;sessionStorage.setItem('workRole',role);sessionStorage.setItem('workUsername',username);sessionStorage.setItem('workCode',code);e.target.reset();$('#code-message').textContent='';$('#code-dialog').close();updateMode();notice(role==='supervisor'?'เข้าสู่โหมดหัวหน้าแล้ว':'เข้าสู่โหมดปฏิบัติงานแล้ว');});
$('#refresh-btn').addEventListener('click',()=>load());
['#ticket-search','#ticket-date-from','#ticket-date-to'].forEach(selector=>$(selector).addEventListener('input',renderTickets));
['#ticket-person-filter','#ticket-job-filter','#ticket-filter'].forEach(selector=>$(selector).addEventListener('change',renderTickets));
$('#clear-ticket-filters').addEventListener('click',()=>{['#ticket-search','#ticket-person-filter','#ticket-job-filter','#ticket-date-from','#ticket-date-to'].forEach(selector=>$(selector).value='');$('#ticket-filter').value='all';renderTickets();});
$('#print-report-btn').addEventListener('click',printReport);
window.addEventListener('beforeprint',()=>{if(document.body.classList.contains('print-tickets'))populateReport(selectedTickets(),ticketFilters());});
window.addEventListener('afterprint',()=>document.body.classList.remove('print-tickets'));
$('#new-ticket-btn').addEventListener('click',async()=>{
  const jobs=state.jobs.filter(j=>j.active),people=state.people.filter(p=>p.active);
  if(!jobs.length||!people.length){notice('ต้องมีประเภทงานและพนักงานก่อนสร้างใบเบิก',true);return;}
  state.bom=null;state.stockLines=[];$('#ticket-form').reset();
  const [bomLoaded,stockLoaded]=await Promise.all([loadBom(),loadStockCatalog()]);
  if(!bomLoaded&&!stockLoaded){notice('โหลดทั้ง BOM และ Stock ไม่สำเร็จ ยังสร้างใบเบิกไม่ได้',true);return;}
  $('#ticket-form [name="job_type_id"]').innerHTML=jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');
  $('#ticket-form [name="assignee_id"]').innerHTML=people.map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');
  $('#ticket-form [name="source_mode"][value="stock"]').checked=!bomLoaded;
  if(bomLoaded)renderBomOptions();else $('#bom-select').innerHTML='<option value="">โหลด BOM ไม่สำเร็จ</option>';
  renderStockLines();setTicketMode();$('#ticket-dialog').showModal();
});
$('#bom-search').addEventListener('input',renderBomOptions);
$('#bom-select').addEventListener('change',()=>{renderBomPreview();renderStockMatch();});
$('#ticket-form [name="requested_qty"]').addEventListener('input',renderBomPreview);
document.querySelectorAll('#ticket-form [name="source_mode"]').forEach(input=>input.addEventListener('change',setTicketMode));
$('#stock-code').addEventListener('input',renderStockMatch);
$('#add-stock-line').addEventListener('click',()=>{
  const item=currentStockItem(),qty=Number($('#stock-qty').value);
  if(!item){notice('เลือกรหัสที่มีอยู่ใน Stock ล่าสุด',true);return;}
  if(!Number.isFinite(qty)||qty<=0||qty>1000000000||Math.round(qty*10000)!==qty*10000){notice('ใส่จำนวนเบิกที่ถูกต้อง ไม่เกิน 4 ตำแหน่งทศนิยม',true);return;}
  if(state.stockLines.some(line=>line.pk_code===item.code)||!stockMode()&&chosenFormula()?.lines.some(line=>line.pk_code.toUpperCase()===item.code)){notice('รหัสนี้อยู่ในใบเบิกแล้ว',true);return;}
  state.stockLines.push({source:'stock',pk_code:item.code,pk_name:item.name,unit:item.unit,required_qty:qty,stock_snapshot_id:state.stock.snapshot_id,stock_report_date:state.stock.report_date,stock_snapshot_saved_at:state.stock.snapshot_saved_at});
  $('#stock-code').value='';$('#stock-qty').value='';renderStockLines();
});
$('#ticket-form').addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.target),manual=stockMode(),formula=manual?null:chosenFormula(),qty=manual?null:Number(f.get('requested_qty'));
  if(!manual&&(!formula||!Number.isFinite(qty)||qty<=0||qty>1000000||Math.round(qty*1000)!==qty*1000)){notice('เลือกสูตรและใส่จำนวน FG ที่ถูกต้อง',true);return;}
  if(!manual&&formula.lines.some(line=>!Number.isFinite(Number(line.qty_per_unit))||Number(line.qty_per_unit)<=0)){notice('สูตรนี้มีอัตราใช้วัสดุไม่ครบ',true);return;}
  if(manual&&!state.stockLines.length){notice('เพิ่มรหัสจาก Stock อย่างน้อย 1 รายการ',true);return;}
  const bomLines=manual?[]:formula.lines.map(line=>({...line,required_qty:calcQty(line.qty_per_unit,qty)}));
  if(state.stockLines.some(line=>bomLines.some(bom=>bom.pk_code.toUpperCase()===line.pk_code))){notice('รายการนอก BOM ซ้ำกับสูตรที่เลือก กรุณาลบรายการซ้ำ',true);return;}
  if(state.stockLines.length){
    if(!await loadStockCatalog()){notice('ยืนยันรหัสกับ Stock ล่าสุดไม่สำเร็จ กรุณาลองใหม่',true);return;}
    for(const line of state.stockLines){
      const latest=state.stock.items.find(item=>item.code===line.pk_code);
      if(!latest||latest.unit!==line.unit){notice(`รหัส ${line.pk_code} ไม่ตรงกับ Stock ล่าสุด กรุณาตรวจรายการใหม่`,true);return;}
      line.pk_name=latest.name;line.stock_snapshot_id=state.stock.snapshot_id;
      line.stock_report_date=state.stock.report_date;line.stock_snapshot_saved_at=state.stock.snapshot_saved_at;
    }
  }
  const args={p_ticket_no:String(f.get('ticket_no')).trim(),p_job_type_id:f.get('job_type_id'),p_assignee_id:f.get('assignee_id'),p_description:String(f.get('description')||'').trim(),p_fg_code:formula?.fg_code||null,p_fg_name:formula?.fg_name||null,p_requested_qty:qty,p_bom_version:formula?state.bom.source_sha256:null,p_bom_materials:bomLines,p_stock_lines:state.stockLines};
  if(await mutate('create_withdrawal_ticket_as_supervisor',args,'บันทึกใบเบิกแล้ว')){e.target.reset();state.stockLines=[];$('#ticket-dialog').close();}
});
$('#staff-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(name&&await mutate('add_staff_as_supervisor',{p_name:name},'เพิ่มพนักงานแล้ว'))e.target.reset();});
$('#job-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(name&&await mutate('add_job_as_supervisor',{p_name:name},'เพิ่มประเภทงานแล้ว'))e.target.reset();});
document.addEventListener('change',async e=>{let fn,args;if(e.target.matches('[data-active]')){fn='set_staff_active_as_supervisor';args={p_staff_id:e.target.dataset.active,p_active:e.target.checked};}else if(e.target.matches('[data-job-active]')){fn='set_job_active_as_supervisor';args={p_job_id:e.target.dataset.jobActive,p_active:e.target.checked};}else if(e.target.matches('[data-skill]')){fn='set_skill_rating_as_supervisor';args={p_staff_id:e.target.dataset.skill,p_job_id:e.target.dataset.job,p_level:Number(e.target.value)};}else return;await mutate(fn,args,'บันทึกแล้ว');});

async function boot(){if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY){syncLabel('ยังไม่ตั้งค่าฐานข้อมูล');notice('ยังไม่ได้ตั้งค่าฐานข้อมูลกลาง',true);return;}state.db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});if(state.role&&state.username&&state.code){const {data,error}=await state.db.rpc('verify_role_code',{p_role:state.role,p_username:state.username,p_code:state.code});if(!error&&data)state.verified=true;else clearRole();}updateMode();await load();setInterval(()=>{if(!document.hidden)load(true)},15000);}
boot();
