import { workMinutes, workDurationText } from './work-duration.mjs';
import { prepareStaffPhoto } from './staff-photo.mjs';
import { pickError, confirmedPickSummary, actualFromInput, pickVarianceText } from './picking.mjs?v=2';
import { presetDates } from './dashboard-filters.mjs';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PK_WMS_URL, PK_WMS_PUBLISHABLE_KEY } from './config.js';
import { filterTickets } from './ticket-report.mjs';
import { automaticSkill, completedJobWorkload, personPerformance } from './skill-metrics.mjs?v=2';
import { matchesKeywords, searchStock } from './stock-search.mjs';
import { formatBangkokClock, formatBangkokDateTime, fromBangkokInput, timeEditError, toBangkokInput } from './ticket-time.mjs?v=2';
import { ticketNumberExists, suggestTicketNumber, isDuplicateTicketNumberError } from './ticket-number.mjs';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = formatBangkokDateTime;
const fmtReport = formatBangkokDateTime;
const fmtAudit = v => v ? new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(v)) : '—';
sessionStorage.removeItem('editCode');
const state = {db:null,role:sessionStorage.getItem('workRole')||'',username:sessionStorage.getItem('workUsername')||'',code:sessionStorage.getItem('workCode')||'',verified:false,people:[],jobs:[],tickets:[],deletedTickets:[],skills:[],bom:null,selectedFormulaCode:'',stock:null,stockLines:[],view:'dashboard'};
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
  const file=person.photo_data||portraitFiles[person.id];
  return file?`<img class="${className}" src="${file}" alt="ภาพ ${esc(person.display_name)}" loading="lazy" width="72" height="72">`:`<span class="${className} avatar-fallback" aria-hidden="true">${esc(person.display_name?.slice(0,1)||'?')}</span>`;
}
const jobFor = id => state.jobs.find(j=>j.id===id)?.name||'ไม่พบประเภทงาน';
const qtyText = value => new Intl.NumberFormat('th-TH',{maximumFractionDigits:4}).format(Number(value));
const calcQty = (rate, qty) => Math.round((Number(rate)*qty+Number.EPSILON)*10000)/10000;
const statusLabels={queued:'รอดำเนินการ',active:'กำลังทำ',paused:'พักงาน',done:'เสร็จแล้ว',partial:'เบิกไม่ครบ',cancelled:'ยกเลิก'};
const eventLabels={created:'สร้างใบเบิก',imported:'ข้อมูลก่อนเปิดประวัติ',started:'เริ่มงาน',paused:'พักงาน',resumed:'ทำงานต่อ',completed:'จบงาน',partial:'เบิกไม่ครบ',cancelled:'ยกเลิก',edited:'แก้ไขใบเบิก',deleted:'ลบใบเบิก',restored:'กู้คืนใบเบิก'};
const eventConfig={delete:{title:'ลบใบเบิก',rpc:'set_ticket_deleted_as_supervisor',required:true,success:'ลบใบเบิกแล้ว'},restore:{title:'กู้คืนใบเบิก',rpc:'set_ticket_deleted_as_supervisor',required:true,success:'กู้คืนใบเบิกแล้ว'},pause:{title:'พักงาน',rpc:'pause_ticket_as_operator',required:true,success:'พักงานแล้ว'},resume:{title:'กลับมาทำงานต่อ',rpc:'resume_ticket_as_operator',required:false,success:'กลับมาทำงานแล้ว'},partial:{title:'ปิดงานเป็นเบิกไม่ครบ',rpc:'mark_ticket_partial_as_operator',required:true,success:'ปิดงานเป็นเบิกไม่ครบแล้ว'},cancel:{title:'ยกเลิกใบเบิก',rpc:'cancel_ticket_as_supervisor',required:true,success:'ยกเลิกใบเบิกแล้ว'}};
let pendingEvent=null,editingTicketId=null;
const expandedTickets=new Set();
const chosenFormula = () => state.bom?.formulas.find(f=>f.fg_code===state.selectedFormulaCode);
function materialTable(lines){return '<div class="bom-table-wrap"><table class="bom-table"><thead><tr><th>รหัส / วัสดุ</th><th>ต้องเบิก</th><th>เบิกจริง / ขาด–เกิน</th></tr></thead><tbody>'+lines.map(l=>{
  const confirmed=l.confirmed_at&&typeof l.actual_qty==='number';
  return `<tr><td><strong>${esc(l.pk_code)}</strong><small>${esc(l.pk_name)}</small><small>${l.source==='stock'?'นอก BOM':'BOM'}</small></td><td>${qtyText(l.required_qty)} ${esc(l.unit)}</td><td>${confirmed?`<strong>จริง ${qtyText(l.actual_qty)} ${esc(l.unit)}</strong><small>${esc(pickVarianceText(l.required_qty,l.actual_qty,l.unit,qtyText))}</small>${l.short_reason?'<small>เหตุผล: '+esc(l.short_reason)+'</small>':''}`:'ยังไม่ยืนยัน'}</td></tr>`;
}).join('')+'</tbody></table></div>';}
function renderBomOptions(){
  if(!state.bom){$('#bom-results').innerHTML='';$('#bom-source').textContent='โหลด BOM ไม่สำเร็จ';renderBomPreview();return;}
  const term=$('#bom-search').value.trim();
  const matches=term?state.bom.formulas.filter(f=>matchesKeywords(f.fg_code,f.fg_name,term)):[];
  const exact=matches.find(f=>f.fg_code.toLocaleLowerCase('th-TH')===term.toLocaleLowerCase('th-TH'));
  state.selectedFormulaCode=(exact||matches.length===1?exact||matches[0]:null)?.fg_code||'';
  $('#bom-results').innerHTML=matches.slice(0,30).map(f=>`<button type="button" class="bom-result ${f.fg_code===state.selectedFormulaCode?'selected':''}" data-bom-choice="${esc(f.fg_code)}" aria-pressed="${f.fg_code===state.selectedFormulaCode}"><strong>${esc(f.fg_code)}</strong><span>${esc(f.fg_name)}</span></button>`).join('');
  $('#bom-source').textContent=`สูตรจาก PK WMS · ${state.bom.formulas.length} สินค้า · ${!term?'พิมพ์เพื่อค้นหา':!matches.length?'ไม่พบสูตรที่ตรงกับคำค้น':`พบ ${matches.length} รายการ${matches.length>30?' · แสดง 30 รายการแรก':''}${state.selectedFormulaCode?' · เลือกสูตรแล้ว':' · กดเลือกรายการที่ต้องการ'}`} · ไม่รวมยอดสต็อก`;
  renderBomPreview();
  renderStockMatch();
}
function renderBomPreview(){
  if(!$('#bom-fields').hidden&& !state.bom){$('#bom-preview').innerHTML=empty('โหลด BOM ไม่สำเร็จ เลือกเบิกเฉพาะรายการ Stock ได้');return;}
  const f=chosenFormula(),qty=Number($('#ticket-form [name="requested_qty"]').value);
  if(!f){$('#bom-preview').innerHTML=empty('พิมพ์รหัสหรือชื่อสินค้า FG แล้วเลือกรายการที่ต้องการจากผลค้นหา');return;}
  if(f.lines.some(l=>!Number.isFinite(Number(l.qty_per_unit))||Number(l.qty_per_unit)<=0)){$('#bom-preview').innerHTML=empty('สูตรนี้มีอัตราใช้วัสดุไม่ครบ กรุณาตรวจสูตรใน PK WMS ก่อนสร้างใบเบิก');return;}
  if(!Number.isFinite(qty)||qty<=0){$('#bom-preview').innerHTML=`<div class="bom-summary"><strong>${esc(f.fg_code)} · ${esc(f.fg_name)}</strong><span>${f.lines.length} รายการวัสดุ</span></div><div class="bom-table-wrap"><table class="bom-table"><thead><tr><th>รหัส PK / วัตถุดิบ</th><th>อัตราต่อ 1 FG</th></tr></thead><tbody>${f.lines.map(l=>`<tr><td><strong>${esc(l.pk_code)}</strong><small>${esc(l.pk_name)}</small></td><td>${qtyText(l.qty_per_unit)} ${esc(l.unit)}</td></tr>`).join('')}</tbody></table></div><p class="hint">ใส่จำนวนที่ต้องการผลิตเพื่อคำนวณจำนวนเบิก</p>`;return;}
  const lines=f.lines.map(l=>({...l,required_qty:calcQty(l.qty_per_unit,qty)}));
  $('#bom-preview').innerHTML=`<div class="bom-summary"><strong>${esc(f.fg_code)} · ${esc(f.fg_name)}</strong><span>จำนวน ${qtyText(qty)} FG · ${lines.length} รายการวัสดุ</span></div>${materialTable(lines)}<p class="hint">จำนวนเบิกคำนวณตาม BOM (4 ตำแหน่ง) กรุณาตรวจสอบหน่วยและจำนวนจริงก่อนเบิก</p>`;
}
const stockMode=()=>document.querySelector('#ticket-form [name="source_mode"]:checked')?.value==='stock';
function setTicketMode(){
  const manual=stockMode();$('#bom-fields').hidden=manual;
  $('#bom-search').required=!manual;
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
    renderStockMatch();return true;
  }catch(error){
    $('#stock-source').textContent=`โหลด Stock ล่าสุดไม่สำเร็จ (${error.message}) · ยังเพิ่มรายการนอก BOM ไม่ได้`;
    renderStockMatch();return false;
  }
}
function currentStockItem(){const code=$('#stock-code').value.trim().toUpperCase();return state.stock?.items.find(item=>item.code===code);}
function renderStockMatch(){
  const input=$('#stock-code'),item=currentStockItem(),query=input.value.trim(),code=item?.code;
  const exists=state.stockLines.some(line=>line.pk_code===code);
  const inBom=!stockMode()&&!!chosenFormula()?.lines.some(line=>line.pk_code.toUpperCase()===code);
  const {matches,total}=state.stock?searchStock(state.stock.items,query):{matches:[],total:0};
  $('#stock-results').innerHTML=matches.map(row=>{
    const duplicate=state.stockLines.some(line=>line.pk_code===row.code)||!stockMode()&&!!chosenFormula()?.lines.some(line=>line.pk_code.toUpperCase()===row.code);
    return `<button type="button" class="stock-result" data-stock-choice="${esc(row.code)}" ${duplicate?'disabled':''}><strong>${esc(row.code)}</strong><span>${esc(row.name)}</span><small>${esc(row.unit)}${duplicate?' · อยู่ในใบเบิกแล้ว':''}</small></button>`;
  }).join('');
  $('#stock-match').textContent=!state.stock?'รอเชื่อมต่อ Stock ล่าสุด':!query?'พิมพ์รหัส ชื่อ หรือคำบางส่วนเพื่อค้นหา':item?(exists||inBom?'รหัสนี้อยู่ในใบเบิกแล้ว':`เลือก ${item.code} · ${item.name} · หน่วย ${item.unit}`):total?`พบ ${total} รายการ · เลือกรายการจากผลค้นหา${total>matches.length?` (แสดง ${matches.length} รายการแรก)` : ''}`:'ไม่พบรายการใน Stock ล่าสุด';
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

function notice(msg,error=false){const el=$('#notice');el.textContent=msg;el.hidden=!msg;el.classList.toggle('error',error);}
function showTicketNumberConflict(){
  const input=$('#ticket-form [name="ticket_no"]'),number=input.value.trim();
  const suggestion=suggestTicketNumber(state.tickets,number);
  $('#ticket-no-message').textContent=`เลขที่ใบเบิก ${number} มีอยู่แล้ว กรุณาใช้เลขอื่น`;
  const button=$('#ticket-no-suggestion');button.hidden=!suggestion;
  if(suggestion){button.textContent=`ใช้เลข ${suggestion}`;button.dataset.suggestion=suggestion;}
  input.setAttribute('aria-invalid','true');input.focus();
}
function checkTicketNumber(){
  const input=$('#ticket-form [name="ticket_no"]');
  if(ticketNumberExists(state.tickets,input.value)){showTicketNumberConflict();return false;}
  $('#ticket-no-message').textContent='';$('#ticket-no-suggestion').hidden=true;
  input.removeAttribute('aria-invalid');return true;
}
function syncLabel(msg,ok=false){$('#sync-label').textContent=msg;$('.sync-dot').classList.toggle('online',ok);}
function updateMode(){
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!supervisor());
  $('#user-label').textContent=supervisor()?`หัวหน้า · ${state.username}`:operator()?`ผู้ปฏิบัติงาน · ${state.username}`:'โหมดดูข้อมูล';
  $('#edit-btn').textContent=editing()?'ออกจากโหมด':'เข้าสู่โหมดทำงาน';
  if(!supervisor()&&['people','settings'].includes(state.view))showView('dashboard');
  const trash=$('#ticket-filter option[value=deleted]');if(trash)trash.remove();
  if(supervisor())$('#ticket-filter').insertAdjacentHTML('beforeend','<option value="deleted">ถังขยะ (หัวหน้า)</option>');
  else {state.deletedTickets=[];if($('#ticket-filter').value==='deleted')$('#ticket-filter').value='all';}
  render();
}
function showView(view){state.view=view;if(view!=='tickets')document.body.classList.remove('print-tickets');document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`${view}-view`);document.querySelectorAll('#nav button').forEach(el=>{const active=el.dataset.view===view;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});window.scrollTo({top:0,behavior:'instant'});}
async function load(silent=false){
  if(!state.db)return;
  syncLabel('กำลังซิงก์…');
  const {data,error}=await state.db.rpc('get_dashboard_state');
  if(error){syncLabel('ซิงก์ไม่สำเร็จ');if(!silent)notice(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`,true);return;}
  state.people=data.people||[];state.jobs=data.jobs||[];state.tickets=data.tickets||[];state.skills=data.skills||[];
  state.deletedTickets=[];
  if(supervisor()){const trash=await state.db.rpc('get_deleted_tickets_as_supervisor',{p_username:state.username,p_code:state.code});if(trash.error){if(!silent)notice('โหลดถังขยะไม่สำเร็จ',true);}else if(supervisor())state.deletedTickets=trash.data||[];}
  syncLabel(`อัปเดต ${formatBangkokClock(Date.now())} น. (เวลาไทย)`,true);
  render();
}
function render(){renderDashboard();renderTickets();if(supervisor()){renderPeople();renderSettings();}}
function renderExperienceMatrix(people,jobs,tickets){
  if(!people.length||!jobs.length)return empty('ยังไม่มีพนักงานหรือประเภทงาน เข้าสู่โหมดหัวหน้าเพื่อเริ่มบันทึก');
  return `<table class="matrix"><thead><tr><th>พนักงาน</th>${jobs.map(job=>`<th>${esc(job.name)}</th>`).join('')}</tr></thead><tbody>${people.map(person=>`<tr><td><div class="matrix-person">${personPortrait(person)}<span class="person-name">${esc(person.display_name)}</span></div></td>${jobs.map(job=>{
    const workload=completedJobWorkload(person.id,job.id,tickets);
    const level=automaticSkill(workload.tickets);
    const assessed=state.skills.find(skill=>skill.profile_id===person.id&&skill.job_type_id===job.id)?.level||0;
    return `<td><div class="experience-cell"><span class="skill-badge level-${level}" aria-label="ประสบการณ์ระดับ ${level}">${level}</span><div class="experience-detail"><strong>${qtyText(workload.tickets)} ใบจบ · ${qtyText(workload.materialLines)} รายการ</strong><span>รายการวัสดุตามใบเบิกที่จบ</span><span class="experience-assessment">หัวหน้าประเมิน: ${assessed?`ระดับ ${assessed}`:'ยังไม่ประเมิน'}</span></div></div></td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderDashboard(){
  const jobSelect=$('#dashboard-job'),jobId=jobSelect.value;
  jobSelect.innerHTML='<option value="">ทุก Job</option>'+state.jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');jobSelect.value=jobId;
  const preset=$('#dashboard-period').value;
  if(preset!=='custom'){const range=presetDates(preset);$('#dashboard-from').value=range.dateFrom;$('#dashboard-to').value=range.dateTo;}
  const filters={dateFrom:$('#dashboard-from').value,dateTo:$('#dashboard-to').value,jobId:jobSelect.value};
  const invalid=filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo;
  const t=filterTickets(state.tickets,filters);
  $('#dashboard-scope').textContent=invalid?'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด':`พบ ${t.length} ใบ · วันที่สร้างใบเบิก (เวลาไทย): ${filters.dateFrom||'ไม่จำกัด'} ถึง ${filters.dateTo||'ไม่จำกัด'} · ${filters.jobId?jobFor(filters.jobId):'ทุก Job'} · ใช้กับทุกส่วนในภาพรวมและระดับประสบการณ์ / ระดับหัวหน้าประเมินเป็นค่าล่าสุด`;
  $('#dashboard-scope').classList.toggle('error',!!invalid);
  $('#dashboard-total').textContent=qtyText(t.length);
  $('#metrics').innerHTML=[['queued','รอดำเนินการ'],['active','กำลังทำ'],['paused','พักงาน'],['done','เสร็จแล้ว'],['partial','เบิกไม่ครบ'],['cancelled','ยกเลิก']].map(([status,label])=>`<div class="metric metric-${status}"><div class="metric-label"><span class="metric-dot" aria-hidden="true"></span>${label}</div><div class="metric-value">${qtyText(t.filter(x=>x.status===status).length)}</div></div>`).join('');
  const people=state.people.filter(p=>p.active).sort((a,b)=>{
    const ai=featuredOrder.indexOf(a.id),bi=featuredOrder.indexOf(b.id);
    return (ai<0?Infinity:ai)-(bi<0?Infinity:bi)||a.display_name.localeCompare(b.display_name,'th');
  }),jobs=state.jobs.filter(j=>(j.active||j.id===jobId)&&(!jobId||j.id===jobId));
  $('#performance-list').innerHTML=people.length?people.map(p=>{
    const perf=personPerformance(p.id,t);
    const materialLines=t.filter(ticket=>ticket.assignee_id===p.id&&ticket.status==='done').reduce((sum,ticket)=>sum+(Array.isArray(ticket.materials)?ticket.materials.length:0),0);
    const time=perf.medianMinutes===null?'—':perf.medianMinutes<1?'<1 นาที':perf.medianMinutes<60?`${Math.round(perf.medianMinutes)} นาที`:`${(perf.medianMinutes/60).toFixed(1)} ชม.`;
    const closed=perf.done+perf.partial;
    const picks=confirmedPickSummary(t.filter(ticket=>ticket.assignee_id===p.id));
    return `<article class="performance-card"><div class="performance-person">${personPortrait(p,'performance-avatar')}<div><h4>${esc(p.display_name)}</h4><span>ได้รับ ${qtyText(perf.total)} ใบเบิก</span></div></div><div class="workload-summary"><div><strong>${qtyText(perf.done)}</strong><span>ใบที่จบ</span></div><div><strong>${qtyText(materialLines)}</strong><span>รายการวัสดุในใบที่จบ</span></div></div><p class="pick-summary">ยืนยันแล้ว ${picks.confirmed} รายการ · เบิกขาด ${picks.short} รายการ · เบิกเกิน ${picks.over} รายการ · ยังไม่ยืนยัน ${picks.unknown} รายการ</p><div class="performance-stats"><div><strong>${qtyText(perf.open)}</strong><span>งานที่ยังเปิด</span></div><div><strong>${qtyText(perf.partial)}</strong><span>เบิกไม่ครบ</span></div><div><strong>${perf.completionRate===null?'—':`${perf.completionRate}%`}</strong><span>อัตราจบงาน${closed?` (${qtyText(closed)} ใบ)` : ''}</span></div><div><strong>${time}</strong><span>เวลามัธยฐาน</span></div></div></article>`;
  }).join(''):empty('ยังไม่มีพนักงานที่เปิดใช้งาน');
  $('#matrix').innerHTML=renderExperienceMatrix(people,jobs,t);
  const active=t.filter(x=>['active','paused'].includes(x.status)).sort((a,b)=>Date.parse(b.started_at||b.created_at)-Date.parse(a.started_at||a.created_at)).slice(0,5);
  $('#active-list').innerHTML=active.length?active.map(ticket=>`<div class="dashboard-queue-item"><span class="queue-status ${esc(ticket.status)}">${esc(statusLabels[ticket.status])}</span><div class="queue-details"><strong>${esc(ticket.ticket_no)}</strong><span>${esc(jobFor(ticket.job_type_id))} · ${esc(nameFor(ticket.assignee_id))}</span></div><time>${esc(fmt(ticket.started_at))}</time></div>`).join(''):`<div class="dashboard-queue-empty"><strong>ไม่มีงานที่กำลังทำหรือพักอยู่</strong><span>ใบเบิกที่เริ่มงานแล้วจะแสดงที่นี่</span></div>`;
}
function ticketHtml(t){
  const status=statusLabels[t.status]||t.status;
  const button=(action,label,primary=false)=>`<button type="button" class="${primary?'primary':'text-btn'}" data-action="${action}" data-id="${esc(t.id)}">${label}</button>`;
  let actions='';
  if(!t.deleted_at&&operator()){
    if(['active','paused'].includes(t.status)&&t.materials?.length)actions+=button('picks','ยืนยันเบิกจริง');
    if(t.status==='queued')actions+=button('start','เริ่มงาน',true);
    if(t.status==='active')actions+=button('pause','พักงาน')+button('partial','เบิกไม่ครบ')+button('finish','จบงาน',true);
    if(t.status==='paused')actions+=button('resume','ทำงานต่อ',true)+button('partial','เบิกไม่ครบ');
  }
  if(supervisor()&&t.deleted_at){actions+=button('restore','กู้คืน');}
  if(supervisor()&&!t.deleted_at){
    actions+=button('edit','แก้ไข')+button('delete','ลบ');
    if(['active','paused','done','partial'].includes(t.status)&&t.materials?.length)actions+=button('edit-picks','แก้ไขเบิกจริง');
    if(['queued','active','paused'].includes(t.status))actions+=button('cancel','ยกเลิก');
  }
  actions+=button('history','ประวัติ');
  const duration=workMinutes(t.started_at,t.ended_at)===null?'':` · ${workDurationText(t.started_at,t.ended_at)} (หักพักเที่ยง)`;
  const varianceLines=(t.materials||[]).filter(line=>line.confirmed_at&&typeof line.actual_qty==='number'&&Math.round((line.actual_qty-Number(line.required_qty))*10000)!==0);
  const variance=varianceLines.length?`<section class="ticket-variance" aria-label="รายการเบิกขาดหรือเกิน"><h5>รายการเบิกขาดหรือเกิน · ${varianceLines.length} รายการ</h5>${materialTable(varianceLines)}</section>`:'';
  const bom=`${t.fg_code?`<div class="ticket-fg"><strong>${esc(t.fg_code)} · ${esc(t.fg_name)}</strong><span>จำนวน ${qtyText(t.requested_qty)} FG</span></div>`:''}${Array.isArray(t.materials)&&t.materials.length?`<details class="ticket-materials" data-material-ticket="${esc(t.id)}"${expandedTickets.has(t.id)?' open':''}><summary>ดูรายการเบิก ${t.materials.length} รายการ${t.materials.some(line=>line.source==='stock')?' · มีรายการนอก BOM':''}</summary>${materialTable(t.materials)}</details>`:''}`;
  return `<article class="ticket"><div class="ticket-main"><div class="ticket-code">${esc(t.ticket_no)}</div><h4>${esc(jobFor(t.job_type_id))}</h4><div class="ticket-meta">${esc(nameFor(t.assignee_id))} · สร้าง ${fmt(t.created_at)}</div>${bom}${variance}${t.description?`<p class="ticket-detail">${esc(t.description)}</p>`:''}${t.status_reason?`<p class="ticket-reason"><strong>เหตุผล:</strong> ${esc(t.status_reason)}</p>`:''}</div><div class="ticket-right"><span class="status ${esc(t.status)}">${t.deleted_at?'ลบแล้ว':status}</span><div class="ticket-time">เริ่ม ${fmt(t.started_at)}<br>จบ ${fmt(t.ended_at)}${duration}</div><div class="ticket-actions">${actions}</div></div></article>`;
}
function ticketFilters(){return {query:$('#ticket-search').value,assigneeId:$('#ticket-person-filter').value,jobId:$('#ticket-job-filter').value,status:$('#ticket-filter').value==='all'?'':$('#ticket-filter').value,dateFrom:$('#ticket-date-from').value,dateTo:$('#ticket-date-to').value};}
function renderTicketFilterOptions(){
  for(const [selector,rows,placeholder,label] of [['#ticket-person-filter',state.people,'ทุกคน','display_name'],['#ticket-job-filter',state.jobs,'ทุก Job','name']]){
    const select=$(selector),previous=select.value;
    select.innerHTML=`<option value="">${placeholder}</option>`+rows.map(row=>`<option value="${esc(row.id)}">${esc(row[label])}</option>`).join('');
    select.value=previous;
  }
}
function selectedTickets(){return filterTickets($('#ticket-filter').value==='deleted'&&supervisor()?state.deletedTickets:state.tickets,{...ticketFilters(),status:$('#ticket-filter').value==='deleted'?'':ticketFilters().status});}
function rememberOpenMaterials(){
  $('#ticket-list').querySelectorAll('[data-material-ticket]').forEach(details=>{
    if(details.open)expandedTickets.add(details.dataset.materialTicket);
    else expandedTickets.delete(details.dataset.materialTicket);
  });
}
function renderTickets(){
  rememberOpenMaterials();
  renderTicketFilterOptions();
  const filters=ticketFilters(),invalid=filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo;
  const list=selectedTickets();
  $('#ticket-count').textContent=invalid?'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด':`${list.length} จาก ${filters.status==='deleted'?state.deletedTickets.length:state.tickets.length} รายการ`;
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
    const materials=Array.isArray(ticket.materials)&&ticket.materials.length?`<strong>รายการวัสดุ</strong><div>${ticket.materials.map(line=>`<span>${line.source==='stock'?'[นอก BOM] ':''}${esc(line.pk_code)} ${esc(line.pk_name)}: ${qtyText(line.required_qty)} ${esc(line.unit)} · ${line.confirmed_at?`เบิกจริง ${qtyText(line.actual_qty)} · ${esc(pickVarianceText(line.required_qty,line.actual_qty,line.unit,qtyText))} ${esc(line.short_reason||'')}`:'ยังไม่ยืนยันเบิกจริง'}</span>`).join('')}</div>`:'';
    const detail=materials||ticket.description||ticket.status_reason?`<tr class="report-materials"><td colspan="10">${materials}${ticket.description?`<p><strong>หมายเหตุ:</strong> ${esc(ticket.description)}</p>`:''}${ticket.status_reason?`<p><strong>เหตุผลสถานะ:</strong> ${esc(ticket.status_reason)}</p>`:''}</td></tr>`:'';
    const status=statusLabels[ticket.status]||ticket.status;
    return `<tbody class="report-ticket"><tr><td>${index+1}</td><td><strong>${esc(ticket.ticket_no)}</strong></td><td>${esc(fmtReport(ticket.created_at))}</td><td>${esc(nameFor(ticket.assignee_id))}</td><td>${esc(jobFor(ticket.job_type_id))}</td><td>${ticket.fg_code?`${esc(ticket.fg_code)}<br>${esc(ticket.fg_name||'')}<br><strong>${qtyText(ticket.requested_qty)} FG</strong>`:'—'}</td><td>${esc(status)}</td><td>${esc(fmtReport(ticket.started_at))}</td><td>${esc(fmtReport(ticket.ended_at))}</td><td>${esc(workDurationText(ticket.started_at,ticket.ended_at))}</td></tr>${detail}</tbody>`;
  }).join('');
  $('#print-report').innerHTML=`<header><img src="assets/bcl-logo.png" alt="BCL"><div><h1>รายงานใบเบิกของ</h1><p>พิมพ์เมื่อ ${esc(fmtReport(new Date()))} · เวลาไทย (UTC+7)</p></div></header><div class="report-filter-line"><strong>ตัวกรอง:</strong> ${esc(reportFiltersText(filters))}</div><div class="report-summary"><span>ทั้งหมด <strong>${list.length}</strong></span>${Object.entries(counts).map(([key,count])=>`<span>${statusLabels[key]} <strong>${count}</strong></span>`).join('')}</div><table class="report-table"><thead><tr><th>#</th><th>เลขที่ใบเบิก</th><th>วันที่สร้าง</th><th>พนักงาน</th><th>Job</th><th>FG / จำนวน</th><th>สถานะ</th><th>เริ่ม</th><th>สิ้นสุด</th><th>เวลาทำงาน<br>(หักพักเที่ยง)</th></tr></thead>${rows||'<tbody><tr><td colspan="9">ไม่พบใบเบิกตามตัวกรอง</td></tr></tbody>'}</table><p class="report-note">จำนวนวัสดุคำนวณตาม BOM ที่บันทึกกับใบเบิก ไม่ใช่หลักฐานการตัดสต็อก · เวลาทำงานหักช่วง 12:00–13:00 ของแต่ละวันตามเวลาไทย</p>`;
}
function printReport(){const list=selectedTickets();populateReport(list,ticketFilters());document.body.classList.add('print-tickets');window.print();}
function renderPeople(){$('#people-list').innerHTML=state.people.length?state.people.map(p=>`<div class="person-row"><div class="matrix-person">${personPortrait(p)}<strong>${esc(p.display_name)}</strong></div><div class="person-controls"><button type="button" class="text-btn" data-edit-person="${esc(p.id)}">แก้ไขชื่อ</button><label class="staff-photo-button">เปลี่ยนรูป<input type="file" accept="image/jpeg,image/png,image/webp" data-staff-photo="${esc(p.id)}" aria-label="เปลี่ยนรูป ${esc(p.display_name)}"></label><label class="hint"><input type="checkbox" data-active="${esc(p.id)}" ${p.active?'checked':''}> เปิดใช้งาน</label></div></div>`).join(''):empty('ยังไม่มีพนักงาน');}
function renderSettings(){const people=state.people.filter(p=>p.active),jobs=state.jobs.filter(j=>j.active);$('#job-list').innerHTML=state.jobs.length?state.jobs.map(j=>`<div class="job-row"><strong>${esc(j.name)}</strong><label class="hint"><input type="checkbox" data-job-active="${esc(j.id)}" ${j.active?'checked':''}> เปิดใช้งาน</label></div>`).join(''):empty('ยังไม่มีประเภทงาน');$('#skill-editor').innerHTML=!people.length||!jobs.length?empty('เพิ่มพนักงานและประเภทงานก่อนกำหนดทักษะ'):`<div class="matrix-wrap"><table class="skill-edit-table"><thead><tr><th>พนักงาน</th><th>Job</th><th>ระดับทักษะ</th></tr></thead><tbody>${people.flatMap(p=>jobs.map(j=>{const level=state.skills.find(s=>s.profile_id===p.id&&s.job_type_id===j.id)?.level||0;return `<tr><td>${esc(p.display_name)}</td><td>${esc(j.name)}</td><td><select data-skill="${esc(p.id)}" data-job="${esc(j.id)}">${['ยังไม่ประเมิน','1 · เริ่มต้น','2 · ทำได้','3 · ชำนาญ','4 · สอนงานได้'].map((label,i)=>`<option value="${i}" ${i===level?'selected':''}>${label}</option>`).join('')}</select></td></tr>`})).join('')}</tbody></table></div>`;}
async function mutate(fn,args,success,errorTarget){const {error}=await state.db.rpc(fn,{p_username:state.username,p_code:state.code,...args});if(error){const message=`บันทึกไม่สำเร็จ: ${error.message}`;if(errorTarget)$(errorTarget).textContent=message;else notice(message,true);return false;}if(errorTarget)$(errorTarget).textContent='';notice(success);await load(true);return true;}
function openEvent(kind,ticket){
  pendingEvent={kind,id:ticket.id};const config=eventConfig[kind],form=$('#event-form');
  form.reset();form.elements.reason.required=config.required;
  $('#event-title').textContent=config.title;$('#event-ticket').textContent=`ใบเบิก ${ticket.ticket_no}`;
  $('#event-hint').textContent=kind==='delete'?'ใบเบิกจะย้ายไปถังขยะและไม่นับใน Dashboard หัวหน้าสามารถกู้คืนได้ โดยเลขใบเบิกเดิมยังถูกเก็บไว้':kind==='restore'?'ใบเบิกจะกลับเข้ารายการและ Dashboard ในสถานะเดิม':kind==='partial'?'ใบเบิกจะปิดเป็นเบิกไม่ครบและบันทึกเวลาสิ้นสุด':kind==='cancel'?'ใบเบิกจะถูกปิดและไม่สามารถเริ่มงานต่อได้':kind==='pause'?'เวลาที่เริ่มงานไว้จะคงเดิม และสามารถกลับมาทำงานต่อได้':'เหตุผลเพิ่มเติม (ถ้ามี)';
  $('#event-dialog').showModal();
}
function openEdit(ticket){
  editingTicketId=ticket.id;const form=$('#ticket-edit-form');form.reset();
  $('#ticket-edit-message').textContent='';
  form.elements.ticket_no.value=ticket.ticket_no;
  form.elements.job_type_id.innerHTML=state.jobs.filter(j=>j.active||j.id===ticket.job_type_id).map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');
  form.elements.assignee_id.innerHTML=state.people.filter(p=>p.active||p.id===ticket.assignee_id).map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');
  form.elements.job_type_id.value=ticket.job_type_id;form.elements.assignee_id.value=ticket.assignee_id;
  form.elements.description.value=ticket.description||'';
  form.elements.requested_qty.value=ticket.requested_qty||'';
  form.elements.requested_qty.disabled=!ticket.fg_code;
  form.elements.started_at.value=toBangkokInput(ticket.started_at);
  form.elements.ended_at.value=toBangkokInput(ticket.ended_at);
  form.elements.started_at.disabled=ticket.status==='queued'||ticket.status==='cancelled'&&!ticket.started_at;
  form.elements.ended_at.disabled=['queued','active','paused'].includes(ticket.status);
  form.elements.started_at.required=['active','paused','done','partial'].includes(ticket.status);
  form.elements.ended_at.required=['done','partial','cancelled'].includes(ticket.status);
  $('#edit-time-hint').textContent=ticket.status==='queued'?'งานรอดำเนินการยังไม่มีเวลา กดเริ่มงานก่อนจึงจะแก้เวลาเริ่มได้':ticket.status==='active'||ticket.status==='paused'?'แก้เวลาเริ่มได้ เวลาสิ้นสุดจะบันทึกเมื่อปิดงาน':ticket.status==='cancelled'?'งานที่ยกเลิกแก้เวลาสิ้นสุดได้ และแก้เวลาเริ่มได้เฉพาะใบที่เคยเริ่มงาน':'แก้เวลาเริ่มและสิ้นสุดได้ โดยเวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม';
  $('#ticket-edit-dialog').showModal();
}
function historyChanges(event){
  const before=event.before_state||{},after=event.after_state||{};
  const fields=[['ticket_no','เลขที่ใบเบิก'],['job_type_id','Job'],['assignee_id','พนักงาน'],['description','หมายเหตุ'],['requested_qty','จำนวน FG'],['started_at','เวลาเริ่ม'],['ended_at','เวลาสิ้นสุด']];
  const display=(key,value)=>key==='job_type_id'?jobFor(value):key==='assignee_id'?nameFor(value):key==='requested_qty'?qtyText(value):['started_at','ended_at'].includes(key)?fmtAudit(value):String(value||'—');
  const picks=(after.materials||[]).flatMap((line,i)=>{const prev=before.materials?.[i];return line.actual_qty!==prev?.actual_qty||line.short_reason!==prev?.short_reason?[`<li><strong>${esc(line.pk_code)}</strong> เบิกจริง ${prev?.confirmed_at?qtyText(prev.actual_qty):'ยังไม่ยืนยัน'} → ${line.confirmed_at?qtyText(line.actual_qty):'ยังไม่ยืนยัน'} ${esc(line.unit)} · ${esc(line.short_reason||'')}</li>`]:[];}).join('');
  return picks+fields.filter(([key])=>before[key]!==after[key]).map(([key,label])=>`<li><strong>${label}</strong> ${esc(display(key,before[key]))} → ${esc(display(key,after[key]))}</li>`).join('');
}
async function openHistory(ticket){
  $('#history-title').textContent=`ประวัติ ${ticket.ticket_no}`;$('#history-list').innerHTML=empty('กำลังโหลดประวัติ…');$('#history-dialog').showModal();
  const {data,error}=await state.db.rpc('get_ticket_history',{p_ticket_id:ticket.id});
  if(error){$('#history-list').innerHTML=empty(`โหลดประวัติไม่สำเร็จ: ${error.message}`);return;}
  $('#history-list').innerHTML=data?.length?data.map(event=>`<article class="history-event"><div class="history-event-head"><strong>${esc(eventLabels[event.event_type]||event.event_type)}</strong><time>${esc(fmt(event.created_at))}</time></div><div class="history-actor">${esc(event.actor_role==='supervisor'?'หัวหน้า':event.actor_role==='operator'?'ผู้ปฏิบัติงาน':'ระบบ')} · ${esc(event.actor_username)}</div>${event.reason?`<p><strong>เหตุผล:</strong> ${esc(event.reason)}</p>`:''}${['edited','completed','partial'].includes(event.event_type)?`<ul>${historyChanges(event)}</ul>`:''}</article>`).join(''):empty('ยังไม่มีประวัติ');
}

document.addEventListener('click',async e=>{
  const editPerson=e.target.closest('[data-edit-person]');if(editPerson&&supervisor()){const person=state.people.find(p=>p.id===editPerson.dataset.editPerson);if(person){$('#staff-edit-form [name=staff_id]').value=person.id;$('#staff-edit-form [name=name]').value=person.display_name;$('#staff-edit-message').textContent='';$('#staff-edit-dialog').showModal();}return;}
  const removeStock=e.target.closest('[data-remove-stock]');if(removeStock){state.stockLines.splice(Number(removeStock.dataset.removeStock),1);renderStockLines();return;}
  const nav=e.target.closest('#nav button[data-view]');if(nav){showView(nav.dataset.view);return;}
  if(e.target.closest('[data-dashboard-tickets]')){$('#ticket-date-from').value=$('#dashboard-from').value;$('#ticket-date-to').value=$('#dashboard-to').value;$('#ticket-job-filter').value=$('#dashboard-job').value;$('#ticket-search').value='';$('#ticket-person-filter').value='';$('#ticket-filter').value='all';renderTickets();showView('tickets');return;}
  const action=e.target.closest('button[data-action]');if(action){
    const kind=action.dataset.action,ticket=[...state.tickets,...state.deletedTickets].find(t=>t.id===action.dataset.id);
    if(!ticket)return;
    if(operator()&&['picks','finish','partial'].includes(kind)&&ticket.materials?.length){openPicks(ticket,kind==='finish'?'done':kind==='partial'?'partial':null);return;}
    if(kind==='edit-picks'&&supervisor()){openPicks(ticket,null,true);return;}
    if(kind==='history'){await openHistory(ticket);return;}
    if(kind==='edit'&&supervisor()){openEdit(ticket);return;}
    if(kind in eventConfig){if((['cancel','delete','restore'].includes(kind)&&supervisor())||(!['cancel','delete','restore'].includes(kind)&&operator()))openEvent(kind,ticket);return;}
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
  if(await mutate(config.rpc,{p_ticket_id:id,p_reason:reason,...(['delete','restore'].includes(kind)?{p_deleted:kind==='delete'}:{})},config.success)){$('#event-dialog').close();pendingEvent=null;}
});
$('#ticket-edit-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!supervisor()||!editingTicketId)return;
  const f=new FormData(e.target),ticket=state.tickets.find(t=>t.id===editingTicketId);if(!ticket)return;
  const qty=ticket.fg_code?Number(e.target.elements.requested_qty.value):null,reason=String(f.get('reason')||'').trim();
  if(!reason||ticket.fg_code&&(!Number.isFinite(qty)||qty<=0||qty>1000000||Math.round(qty*1000)!==qty*1000)){$('#ticket-edit-message').textContent='กรุณาระบุเหตุผลและจำนวน FG ที่ถูกต้อง';return;}
  const startValue=e.target.elements.started_at.value,endValue=e.target.elements.ended_at.value;
  const startedAt=fromBangkokInput(startValue,ticket.started_at),endedAt=fromBangkokInput(endValue,ticket.ended_at);
  const timeError=(startValue&&!startedAt||endValue&&!endedAt)?'รูปแบบเวลาไม่ถูกต้อง':timeEditError(ticket.status,startedAt,endedAt,Date.now(),ticket.started_at);
  if(timeError){$('#ticket-edit-message').textContent=timeError;return;}
  const args={p_ticket_id:editingTicketId,p_ticket_no:String(f.get('ticket_no')).trim(),p_job_type_id:f.get('job_type_id'),p_assignee_id:f.get('assignee_id'),p_description:String(f.get('description')||'').trim(),p_requested_qty:qty,p_started_at:startedAt,p_ended_at:endedAt,p_reason:reason};
  if(await mutate('edit_ticket_with_times_as_supervisor',args,'แก้ไขใบเบิกและบันทึกประวัติแล้ว','#ticket-edit-message')){$('#ticket-edit-dialog').close();editingTicketId=null;}
});
function clearRole(){state.role='';state.username='';state.code='';state.verified=false;['workRole','workUsername','workCode'].forEach(key=>sessionStorage.removeItem(key));}
$('#edit-btn').addEventListener('click',()=>{if(editing()){clearRole();updateMode();notice('ออกจากโหมดทำงานแล้ว');}else $('#code-dialog').showModal();});
const themeButton=$('#theme-toggle');
function syncThemeButton(){
  const dark=document.documentElement.dataset.theme!=='light';
  themeButton.setAttribute('aria-pressed',String(dark));
  themeButton.setAttribute('aria-label',dark?'เปลี่ยนเป็นโหมดสว่าง':'เปลี่ยนเป็นโหมดมืด');
  themeButton.querySelector('.theme-icon').textContent=dark?'☾':'☀';
  themeButton.querySelector('.theme-name').textContent=dark?'โหมดมืด':'โหมดสว่าง';
  document.querySelector('meta[name="theme-color"]').content=dark?'#111315':'#f3f5f7';
}
themeButton.addEventListener('click',()=>{
  const next=document.documentElement.dataset.theme==='light'?'dark':'light';
  document.documentElement.dataset.theme=next;
  try{localStorage.setItem('bcl-display-theme',next)}catch{}
  syncThemeButton();
});
window.addEventListener('storage',e=>{if(e.key==='bcl-display-theme'){document.documentElement.dataset.theme=e.newValue==='light'?'light':'dark';syncThemeButton();}});
syncThemeButton();
$('#code-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),role=String(f.get('role')),username=String(f.get('username')).trim(),code=String(f.get('code'));const {data,error}=await state.db.rpc('verify_role_code',{p_role:role,p_username:username,p_code:code});if(error||!data){$('#code-message').textContent='ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';return;}state.role=role;state.username=username;state.code=code;state.verified=true;sessionStorage.setItem('workRole',role);sessionStorage.setItem('workUsername',username);sessionStorage.setItem('workCode',code);e.target.reset();$('#code-message').textContent='';$('#code-dialog').close();updateMode();await load(true);notice(role==='supervisor'?'เข้าสู่โหมดหัวหน้าแล้ว':'เข้าสู่โหมดปฏิบัติงานแล้ว');});
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
  state.bom=null;state.selectedFormulaCode='';state.stockLines=[];$('#ticket-form').reset();
  $('#ticket-no-message').textContent='';$('#ticket-no-suggestion').hidden=true;$('#ticket-form [name="ticket_no"]').removeAttribute('aria-invalid');
  const [bomLoaded,stockLoaded]=await Promise.all([loadBom(),loadStockCatalog()]);
  if(!bomLoaded&&!stockLoaded){notice('โหลดทั้ง BOM และ Stock ไม่สำเร็จ ยังสร้างใบเบิกไม่ได้',true);return;}
  $('#ticket-form [name="job_type_id"]').innerHTML=jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');
  $('#ticket-form [name="assignee_id"]').innerHTML=people.map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');
  $('#ticket-form [name="source_mode"][value="stock"]').checked=!bomLoaded;
  $('#ticket-form [name="source_mode"][value="bom"]').disabled=!bomLoaded;
  if(bomLoaded)renderBomOptions();else{$('#bom-results').innerHTML='';$('#bom-source').textContent='โหลด BOM ไม่สำเร็จ เลือกเบิกเฉพาะ Stock ได้';}
  renderStockLines();setTicketMode();$('#ticket-dialog').showModal();
});
$('#bom-search').addEventListener('input',renderBomOptions);
$('#ticket-form [name="ticket_no"]').addEventListener('input',checkTicketNumber);
$('#ticket-no-suggestion').addEventListener('click',e=>{const input=$('#ticket-form [name="ticket_no"]');input.value=e.currentTarget.dataset.suggestion;checkTicketNumber();input.focus();});
$('#bom-results').addEventListener('click',e=>{
  const choice=e.target.closest('[data-bom-choice]');
  if(!choice)return;
  $('#bom-search').value=choice.dataset.bomChoice;
  renderBomOptions();
  $('#ticket-form [name="requested_qty"]').focus();
});
$('#ticket-form [name="requested_qty"]').addEventListener('input',renderBomPreview);
document.querySelectorAll('#ticket-form [name="source_mode"]').forEach(input=>input.addEventListener('change',setTicketMode));
$('#stock-code').addEventListener('input',renderStockMatch);
$('#stock-results').addEventListener('click',e=>{
  const choice=e.target.closest('[data-stock-choice]');
  if(!choice||choice.disabled)return;
  $('#stock-code').value=choice.dataset.stockChoice;
  renderStockMatch();
  $('#stock-qty').focus();
});
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
  if(!checkTicketNumber())return;
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
  const {error}=await state.db.rpc('create_withdrawal_ticket_as_supervisor',{p_username:state.username,p_code:state.code,...args});
  if(error){
    if(isDuplicateTicketNumberError(error)){await load(true);showTicketNumberConflict();}
    else notice(`บันทึกไม่สำเร็จ: ${error.message}`,true);
    return;
  }
  e.target.reset();state.stockLines=[];$('#ticket-dialog').close();notice('บันทึกใบเบิกแล้ว');await load(true);
});
$('#staff-photo').addEventListener('change',async e=>{
 $('#staff-photo-message').textContent='';$('#staff-photo-preview').hidden=true;
 try{const photo=await prepareStaffPhoto(e.target.files[0]);if(photo){$('#staff-photo-preview').src=photo;$('#staff-photo-preview').hidden=false;}}catch(error){e.target.value='';$('#staff-photo-message').textContent=error.message;}
});
$('#staff-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!supervisor())return;const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;$('#staff-photo-message').textContent='';
 try{const name=String(new FormData(form).get('name')).trim(),photo=await prepareStaffPhoto($('#staff-photo').files[0]);
 if(name&&await mutate('add_staff_with_photo_as_supervisor',{p_name:name,p_photo:photo},'เพิ่มพนักงานแล้ว','#staff-photo-message')){form.reset();$('#staff-photo-preview').hidden=true;}
 }catch(error){$('#staff-photo-message').textContent=error.message;}finally{button.disabled=false;}
});
document.addEventListener('change',async e=>{
 if(!e.target.matches('[data-staff-photo]')||!supervisor()||!e.target.files[0])return;
 const input=e.target;input.disabled=true;
 try{const photo=await prepareStaffPhoto(input.files[0]);await mutate('set_staff_photo_as_supervisor',{p_staff_id:input.dataset.staffPhoto,p_photo:photo},'เปลี่ยนรูปพนักงานแล้ว');}catch(error){notice(error.message,true);}finally{input.disabled=false;input.value='';}
});
$('#job-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(name&&await mutate('add_job_as_supervisor',{p_name:name},'เพิ่มประเภทงานแล้ว'))e.target.reset();});
document.addEventListener('change',async e=>{let fn,args;if(e.target.matches('[data-active]')){fn='set_staff_active_as_supervisor';args={p_staff_id:e.target.dataset.active,p_active:e.target.checked};}else if(e.target.matches('[data-job-active]')){fn='set_job_active_as_supervisor';args={p_job_id:e.target.dataset.jobActive,p_active:e.target.checked};}else if(e.target.matches('[data-skill]')){fn='set_skill_rating_as_supervisor';args={p_staff_id:e.target.dataset.skill,p_job_id:e.target.dataset.job,p_level:Number(e.target.value)};}else return;await mutate(fn,args,'บันทึกแล้ว');});

async function boot(){if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY){syncLabel('ยังไม่ตั้งค่าฐานข้อมูล');notice('ยังไม่ได้ตั้งค่าฐานข้อมูลกลาง',true);return;}state.db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});if(state.role&&state.username&&state.code){const {data,error}=await state.db.rpc('verify_role_code',{p_role:state.role,p_username:state.username,p_code:state.code});if(!error&&data)state.verified=true;else clearRole();}updateMode();await load();setInterval(()=>{if(!document.hidden)load(true)},15000);}
boot();

let pendingPicks=null;
function openPicks(ticket,closeStatus,supervisorEdit=false){
 pendingPicks={id:ticket.id,materials:structuredClone(ticket.materials),status:ticket.status,closeStatus,supervisorEdit};
 $('#pick-title').textContent=(supervisorEdit?'แก้ไขเบิกจริง':closeStatus==='done'?'ยืนยันและจบงาน':closeStatus==='partial'?'ยืนยันและปิดเบิกไม่ครบ':'ยืนยันเบิกจริง')+' · '+ticket.ticket_no;
 $('#pick-message').textContent='';$('#pick-save').textContent=supervisorEdit?'บันทึกการแก้ไข':closeStatus?'บันทึกและปิดงาน':'บันทึกเบิกจริง';
 $('#pick-edit-reason-wrap').hidden=!supervisorEdit;$('#pick-edit-reason').required=supervisorEdit;$('#pick-edit-reason').value='';
 $('#pick-edit-hint').hidden=!supervisorEdit;
 $('#pick-lines').innerHTML=ticket.materials.map((l,i)=>`<fieldset class="pick-line"><legend>${i+1}. ${esc(l.pk_code)}</legend><p>${esc(l.pk_name)}</p><p>ต้องเบิก <strong>${qtyText(l.required_qty)} ${esc(l.unit)}</strong></p><div class="pick-quantity-fields"><label>รูปแบบจำนวน<select aria-label="รูปแบบรายการ ${i+1}" data-pick-mode="${i}"><option value="actual">จำนวนเบิกจริง</option><option value="short">จำนวนขาด</option><option value="over">จำนวนเกิน</option></select></label><label>จำนวน<input aria-label="เบิกจริงรายการ ${i+1}" data-pick-qty="${i}" type="number" required min="0" max="1000000000" step="0.0001" value="${l.confirmed_at?Number(l.actual_qty):''}"></label></div><button class="text-btn" type="button" data-pick-full="${i}">เบิกครบรายการนี้</button><p data-pick-short="${i}" class="hint"></p><label>เหตุผลที่เบิกขาดหรือเกิน<textarea aria-label="เหตุผลรายการ ${i+1}" data-pick-reason="${i}" maxlength="1000">${esc(l.short_reason||'')}</textarea></label></fieldset>`).join('');
 updatePickShorts();$('#pick-dialog').showModal();
}
function readPickActual(i){return actualFromInput(pendingPicks.materials[i].required_qty,$('[data-pick-qty="'+i+'"]').value,$('[data-pick-mode="'+i+'"]').value);}
function updatePickShorts(){if(!pendingPicks)return;pendingPicks.materials.forEach((l,i)=>{const qty=readPickActual(i);$('[data-pick-short="'+i+'"]').textContent=qty===null?'ยังไม่ยืนยัน':!Number.isFinite(qty)||qty<0?'จำนวนไม่ถูกต้อง':'เบิกจริง '+qtyText(qty)+' '+l.unit+' · '+pickVarianceText(l.required_qty,qty,l.unit,qtyText);$('[data-pick-reason="'+i+'"]').required=qty!==null&&qty!==Number(l.required_qty);});}
$('#pick-lines').addEventListener('input',updatePickShorts);
$('#pick-lines').addEventListener('change',updatePickShorts);
$('#pick-lines').addEventListener('click',e=>{const b=e.target.closest('[data-pick-full]');if(b){const i=Number(b.dataset.pickFull);$('[data-pick-mode="'+i+'"]').value='actual';$('[data-pick-qty="'+i+'"]').value=pendingPicks.materials[i].required_qty;updatePickShorts();}});
$('#pick-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!pendingPicks||!(pendingPicks.supervisorEdit?supervisor():operator()))return;
 const p=pendingPicks,picks=p.materials.map((l,i)=>({actual_qty:readPickActual(i),short_reason:$('[data-pick-reason="'+i+'"]').value.trim()}));
 const error=pickError(p.materials,picks,p.supervisorEdit?null:p.closeStatus);if(error){$('#pick-message').textContent=error;return;}
 $('#pick-save').disabled=true;
 const args={p_ticket_id:p.id,p_expected_materials:p.materials,p_expected_status:p.status,p_picks:picks,...(p.supervisorEdit?{p_edit_reason:$('#pick-edit-reason').value.trim()}:{p_close_status:p.closeStatus})};
 try{if(await mutate(p.supervisorEdit?'edit_ticket_picks_as_supervisor':'confirm_ticket_picks_as_operator',args,p.supervisorEdit?'แก้ไขเบิกจริงและบันทึกประวัติแล้ว':p.closeStatus?'บันทึกเบิกจริงและปิดงานแล้ว':'บันทึกเบิกจริงแล้ว','#pick-message'))$('#pick-dialog').close();}finally{$('#pick-save').disabled=false;}
});
$('#staff-edit-form').addEventListener('submit',async e=>{e.preventDefault();if(!supervisor())return;const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;try{if(await mutate('rename_staff_as_supervisor',{p_staff_id:form.elements.staff_id.value,p_name:form.elements.name.value.trim()},'แก้ไขชื่อพนักงานแล้ว','#staff-edit-message'))$('#staff-edit-dialog').close();}finally{button.disabled=false;}});
$('#dashboard-period').addEventListener('change',renderDashboard);
$('#dashboard-job').addEventListener('change',renderDashboard);
['#dashboard-from','#dashboard-to'].forEach(s=>$(s).addEventListener('change',()=>{$('#dashboard-period').value='custom';renderDashboard();}));
$('#dashboard-reset').addEventListener('click',()=>{$('#dashboard-period').value='all';$('#dashboard-job').value='';renderDashboard();});
