import {followupComplete,reportingTickets,varianceRows} from './management.mjs?v=6';
import {installManagement} from './management-ui.mjs?v=4';
import {workBreakdown,minutesText,pickCompleteness,operationalPerformance,reasonLabels,documentsError} from './operations.mjs?v=4';
import { prepareStaffPhoto } from './staff-photo.mjs';
import { pickError, confirmedPickSummary, actualFromInput, pickVarianceText, defaultPickActual, automaticPickCloseStatus } from './picking.mjs?v=7';
import { saveErrorText, createSaveGate } from './ui-feedback.mjs';
import { splitTicketNumbers, ticketReferences, ticketDocumentCount, totalDocuments, ticketNumbersError } from './withdrawal-documents.mjs';
import { presetDates } from './dashboard-filters.mjs';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PK_WMS_URL, PK_WMS_PUBLISHABLE_KEY } from './config.js';
import { filterTickets } from './ticket-report.mjs?v=5';
import { automaticSkill, completedJobWorkload, personPerformance } from './skill-metrics.mjs?v=5';
import { matchesKeywords, searchStock } from './stock-search.mjs';
import { formatBangkokClock, formatBangkokDateTime, fromBangkokInput, timeEditError, toBangkokInput } from './ticket-time.mjs?v=2';
import { ticketNumberExists, ticketNumberConflicts, ticketConflictText, suggestTicketNumber, isDuplicateTicketNumberError } from './ticket-number.mjs?v=3';
import { purgeConfirmationError } from './trash.mjs';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = formatBangkokDateTime;
const fmtReport = formatBangkokDateTime;
const fmtAudit = v => v ? new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(v)) : '—';
sessionStorage.removeItem('editCode');
const state = {db:null,role:sessionStorage.getItem('workRole')||'',username:sessionStorage.getItem('workUsername')||'',code:sessionStorage.getItem('workCode')||'',verified:false,actorId:sessionStorage.getItem('workActorId')||'',standards:[],people:[],jobs:[],tickets:[],deletedTickets:[],skills:[],bom:null,selectedFormulaCode:'',stock:null,stockLines:[],view:'dashboard'};
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
let pendingEvent=null,editingTicketId=null,editingStaffSnapshot=null;
const expandedTickets=new Set();
const saveOnce=createSaveGate();
const chosenFormula = () => state.bom?.formulas.find(f=>f.fg_code===state.selectedFormulaCode);
function materialTable(lines){return '<div class="bom-table-wrap"><table class="bom-table"><thead><tr><th>รหัส / วัสดุ</th><th>ต้องเบิก</th><th>เบิกจริง / ขาด–เกิน</th></tr></thead><tbody>'+lines.map(l=>{
  const confirmed=l.confirmed_at&&typeof l.actual_qty==='number';
  const delta=confirmed?Math.round((l.actual_qty-Number(l.required_qty))*10000):0;
  const varianceClass=delta<-10000?'pick-short':delta>10000?'pick-over':'';
  return `<tr class="${varianceClass}"><td><strong>${esc(l.pk_code)}</strong><small>${esc(l.pk_name)}</small><small>${l.source==='stock'?'นอก BOM':'BOM'}</small></td><td>${qtyText(l.required_qty)} ${esc(l.unit)}</td><td>${confirmed?`${varianceClass?`<span class="pick-variance-badge ${varianceClass}">${delta<0?'▼':'▲'} ${esc(pickVarianceText(l.required_qty,l.actual_qty,l.unit,qtyText))}</span>`:''}<strong>เบิกจริง ${qtyText(l.actual_qty)} ${esc(l.unit)}</strong>${varianceClass?'':`<small>ครบตามใบเบิก</small>`}${varianceClass&&l.short_reason?'<small class="pick-variance-reason">'+esc(reasonLabels[l.reason_code]||'ยังไม่ระบุประเภทเหตุผล')+' · '+esc(l.short_reason)+'</small>':''}`:'ยังไม่ยืนยัน'}</td></tr>`;
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
  const manual=stockMode();$('#bom-fields').hidden=manual;$('#ticket-form').dataset.hasFg=String(!manual);renderDocuments($('#ticket-form'));
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
  const all=[...state.tickets,...state.deletedTickets],conflicts=ticketNumberConflicts(all,number);
  const suggestion=suggestTicketNumber(all,number);
  $('#ticket-no-message').textContent=ticketConflictText(conflicts);
  const existing=$('#ticket-no-existing'),conflict=conflicts[0];
  existing.hidden=!conflict;
  if(conflict){existing.textContent=conflict.deleted?'เปิดใบเดิมในถังขยะ':'เปิดใบเบิกเดิม';existing.dataset.number=conflict.number;existing.dataset.deleted=String(conflict.deleted);}
  const button=$('#ticket-no-suggestion');button.hidden=!suggestion;
  if(suggestion){button.textContent=`ใช้เลข ${suggestion}`;button.dataset.suggestion=suggestion;}
  input.setAttribute('aria-invalid','true');input.focus();
}
function checkTicketNumber(){
  const input=$('#ticket-form [name="ticket_no"]');
  updateDocumentCount(input);
  $('#ticket-no-existing').hidden=true;$('#ticket-no-suggestion').hidden=true;
  const error=ticketNumbersError(input.value);if(error){$('#ticket-no-message').textContent=error;input.setAttribute('aria-invalid','true');return false;}
  if(ticketNumberExists([...state.tickets,...state.deletedTickets],input.value)){showTicketNumberConflict();return false;}
  $('#ticket-no-message').textContent='';
  input.removeAttribute('aria-invalid');return true;
}
function updateDocumentCount(input){
  const form=input.closest('form'),hint=form.querySelector('[data-document-count]');
  if(form.dataset.hasFg!==undefined)renderDocuments(form);
  if(hint)hint.textContent=input.value.trim()?`${new Set(ticketReferences({ticket_no:input.value,fg_code:form.dataset.hasFg==='true'?'selected':null}).map(ref=>ref.toUpperCase())).size} ใบ · รวมเป็น 1 งาน ใช้เวลาเริ่ม–จบชุดเดียว`:'กรอกเลขที่แต่ละใบ คั่นด้วยช่องว่างหรือ ,';
}
function syncLabel(msg,ok=false){$('#sync-label').textContent=msg;$('.sync-dot').classList.toggle('online',ok);}
function updateMode(){
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!supervisor());
  $('#user-label').textContent=supervisor()?`หัวหน้า · ${state.username}`:operator()?`ผู้ทำรายการ · ${nameFor(state.actorId)}`:'โหมดดูข้อมูล';
  $('#edit-btn').textContent=editing()?'ออกจากโหมด':'เข้าสู่โหมดทำงาน';
  if(!supervisor()&&['people','settings','trash','system'].includes(state.view))showView('dashboard');
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
  state.people=data.people||[];state.jobs=data.jobs||[];state.tickets=data.tickets||[];state.skills=data.skills||[];state.standards=data.standards||[];await management.refresh();
  state.deletedTickets=[];
  if(supervisor()){const trash=await state.db.rpc('get_deleted_tickets_as_supervisor',{p_username:state.username,p_code:state.code});if(trash.error){if(!silent)notice('โหลดถังขยะไม่สำเร็จ',true);}else if(supervisor())state.deletedTickets=trash.data||[];}
  syncLabel(`อัปเดต ${formatBangkokClock(Date.now())} น. (เวลาไทย)`,true);
  render();
}
function render(){management.render();renderDashboard();renderTickets();if(supervisor()){renderPeople();renderSettings();renderTrash();}}
function renderExperienceMatrix(people,jobs,tickets){
  if(!people.length||!jobs.length)return empty('ยังไม่มีพนักงานหรือประเภทงาน เข้าสู่โหมดหัวหน้าเพื่อเริ่มบันทึก');
  return jobs.map(job=>`<section class="experience-job"><h4>${esc(job.name)}</h4><div class="experience-table-scroll"><table class="matrix experience-table"><thead><tr><th scope="col">พนักงาน</th><th scope="col">งานที่เบิกครบ</th><th scope="col">ใบเบิกในงานเหล่านี้</th><th scope="col">รายการวัสดุ</th><th scope="col">ประสบการณ์จากงาน</th><th scope="col">หัวหน้าประเมิน</th></tr></thead><tbody>${people.map(person=>{
    const workload=completedJobWorkload(person.id,job.id,tickets);
    const level=automaticSkill(workload.tickets);
    const assessed=state.skills.find(skill=>skill.profile_id===person.id&&skill.job_type_id===job.id)?.level||0;
    const thresholds=[1,3,6,12],next=level<4?`อีก ${thresholds[level]-workload.tickets} งาน → ระดับ ${level+1}`:'ถึงระดับสูงสุดของเกณฑ์นี้';
    const done=tickets.filter(t=>t.assignee_id===person.id&&t.job_type_id===job.id&&t.status==='done');
    return `<tr><th scope="row"><div class="matrix-person">${personPortrait(person)}<span class="person-name">${esc(person.display_name)}</span></div></th><td><button type="button" class="experience-count" data-person-drill="${esc(person.id)}" data-person-job="${esc(job.id)}" data-person-status="done" data-person-completeness="all">${qtyText(workload.tickets)} งาน <span aria-hidden="true">↗</span></button></td><td><strong>${qtyText(totalDocuments(done))} ใบ</strong></td><td><strong>${qtyText(workload.materialLines)} รายการ</strong></td><td><span class="experience-level">ระดับ ${level} / 4</span><small>คำนวณจาก ${workload.tickets} งานที่เบิกครบ</small><small>${next}</small></td><td><span class="experience-assessment-label">${assessed?`ระดับ ${assessed} / 4`:'ยังไม่ประเมิน'}</span><small>ผลประเมินของหัวหน้า</small></td></tr>`;
  }).join('')}</tbody></table></div></section>`).join('');
}
function renderDashboard(){
  const jobSelect=$('#dashboard-job'),jobId=jobSelect.value;
  setSelectOptions(jobSelect,'<option value="">ทุกประเภทงาน</option>'+state.jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join(''));jobSelect.value=jobId;
  const preset=$('#dashboard-period').value;
  if(preset!=='custom'){const range=presetDates(preset);$('#dashboard-from').value=range.dateFrom;$('#dashboard-to').value=range.dateTo;}
  const filters={dateFrom:$('#dashboard-from').value,dateTo:$('#dashboard-to').value,jobId:jobSelect.value,dateBasis:$('#dashboard-date-basis').value};
  const invalid=filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo;
  const t=filterTickets(reportingTickets(state.tickets,state.management?.cases),filters);
  $('#dashboard-scope').textContent=invalid?'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด':`พบ ${totalDocuments(t)} ใบ · ${t.length} งาน · ${dateBasisLabel(filters.dateBasis)} (เวลาไทย): ${filters.dateFrom||'ไม่จำกัด'} ถึง ${filters.dateTo||'ไม่จำกัด'} · ${filters.jobId?jobFor(filters.jobId):'ทุกประเภทงาน'} · ใช้กับทุกส่วนในภาพรวมและระดับประสบการณ์ / ระดับหัวหน้าประเมินเป็นค่าล่าสุด`;
  $('#dashboard-scope').classList.toggle('error',!!invalid);
  $('#dashboard-total').textContent=`${qtyText(t.length)} งาน · ${qtyText(totalDocuments(t))} ใบ`;
  const statusGroups=[['done','เบิกครบแล้ว',t.filter(x=>x.status==='done')],['partial','จบงานแล้ว แต่ยังเบิกไม่ครบ',t.filter(x=>x.status==='partial')],['open','ยังไม่จบงาน',t.filter(x=>['queued','active','paused'].includes(x.status))]];
  const cancelled=t.filter(x=>x.status==='cancelled');if(cancelled.length)statusGroups.push(['cancelled','ยกเลิก',cancelled]);
  $('#metrics').innerHTML=statusGroups.map(([status,label,rows])=>`<button type="button" data-metric-status="${status}" class="metric metric-${status}"><div class="metric-label">${label}</div><div class="metric-value">${qtyText(rows.length)} <small>งาน</small></div><div class="hint">${qtyText(totalDocuments(rows))} ใบเบิก · ดูรายการ →</div></button>`).join('');
  const people=state.people.filter(p=>p.active).sort((a,b)=>{
    const ai=featuredOrder.indexOf(a.id),bi=featuredOrder.indexOf(b.id);
    return (ai<0?Infinity:ai)-(bi<0?Infinity:bi)||a.display_name.localeCompare(b.display_name,'th');
  }),jobs=state.jobs.filter(j=>(j.active||j.id===jobId)&&(!jobId||j.id===jobId));
  $('#performance-list').innerHTML=people.length?people.map(p=>{
    const own=t.filter(ticket=>ticket.assignee_id===p.id),quality=operationalPerformance(own,state.standards,state.management?.cases);const perf=personPerformance(p.id,t);
    const materialLines=t.filter(ticket=>ticket.assignee_id===p.id&&ticket.status==='done').reduce((sum,ticket)=>sum+(Array.isArray(ticket.materials)?ticket.materials.length:0),0);
    const time=perf.medianMinutes===null?'—':perf.medianMinutes<1?'<1 นาที':perf.medianMinutes<60?`${Math.round(perf.medianMinutes)} นาที`:minutesText(perf.medianMinutes);
    const closed=perf.done+perf.partial;
    const picks=confirmedPickSummary(own);const pendingVariances=varianceRows(own,state.management?.cases).filter(r=>r.status!=='resolved');picks.short=pendingVariances.filter(r=>r.delta<0).length;picks.over=pendingVariances.filter(r=>r.delta>0).length;
    const counted=perf.done+perf.open+perf.partial;
    const timeSamples=own.filter(ticket=>ticket.status==='done'&&workBreakdown(ticket)!==null).length;
    const drill=(label,count,status='',completeness='all',unit='รายการ')=>`<button type="button" class="person-issue ${count?'has-issue':''}" data-person-drill="${esc(p.id)}" data-person-status="${status}" data-person-completeness="${completeness}"><span>${label}</span><strong>${qtyText(count)} ${unit}</strong><span aria-hidden="true">→</span></button>`;
    return `<article class="performance-card performance-visual"><div class="performance-person">${personPortrait(p,'performance-avatar')}<div><h4>${esc(p.display_name)}</h4><span>ได้รับ ${qtyText(totalDocuments(own))} ใบ · ${qtyText(perf.total)} งาน</span></div></div>
    <button type="button" class="person-complete" data-person-drill="${esc(p.id)}" data-person-status="done" data-person-completeness="all"><span>เบิกครบแล้ว</span><strong>${perf.done} <small>จาก ${counted} งาน</small></strong><span class="person-complete-link">ดูงานที่เบิกครบ →</span></button>
    <div class="person-work-status">${drill('จบงานแล้ว แต่ยังเบิกไม่ครบ',perf.partial,'partial','all','งาน')}${drill('ยังไม่จบงาน',perf.open,'open','all','งาน')}</div>
    <section class="person-followup"><h5>วัสดุที่ต้องติดตาม</h5>${drill('ยังขาด',picks.short,'','short_pending')}${drill('เบิกเกิน ยังไม่จัดการ',picks.over,'','over_pending')}${drill('ยังไม่บันทึกยอดเบิกจริง',picks.unknown,'','incomplete')}<p>นับรายการวัสดุ · 1 งานอาจมีหลายรายการ</p></section>
    <details class="person-extra"><summary>ปริมาณงานและเวลาทำงาน</summary><dl class="person-facts"><div><dt>ใบเบิกในงานที่เบิกครบ</dt><dd>${qtyText(totalDocuments(own.filter(t=>t.status==='done')))} ใบ</dd></div><div><dt>รายการวัสดุในงานที่เบิกครบ</dt><dd>${qtyText(materialLines)} รายการ</dd></div><div><dt>เวลาทำงานค่ากลางต่อ 1 งาน</dt><dd>${time}</dd></div></dl><p>1 งานอาจรวมหลายใบเบิกสูตรเดียวกัน รายการวัสดุนับตามบรรทัดในงาน ไม่ใช่จำนวนชิ้นที่หยิบ</p><p>เวลาค่ากลางคำนวณจาก ${timeSamples} งานที่เบิกครบ โดยเรียงเวลาจากน้อยไปมากแล้วใช้ค่าตรงกลาง หักเวลาพักและเวลานอกกะแล้ว</p><p>งานยกเลิก ${perf.total-counted} งาน ไม่รวมในยอดหลัก</p><p>อัตราเบิกครบในงานที่จบ <strong>${perf.completionRate===null?'—':perf.completionRate+'%'}</strong> (${perf.done} จาก ${closed} งาน)</p><p>ข้อมูลครบ ${quality.complete} งาน · บันทึกยอดแล้ว ${picks.confirmed} รายการ</p><p>หยิบผิดที่ระบุเหตุผล ${quality.pickingErrors} รายการ · ต้องตรวจเหตุผล ${quality.reviewNeeded} รายการ</p><p>เทียบมาตรฐาน: ${quality.efficiency===null?'ยังไม่มีข้อมูลและมาตรฐานที่ตรงกัน':quality.efficiency+'% จาก '+quality.matched+' งาน'}</p></details></article>`;

  }).join(''):empty('ยังไม่มีพนักงานที่เปิดใช้งาน');
  $('#matrix').innerHTML=renderExperienceMatrix(people,jobs,t);renderAttention();
  const active=t.filter(x=>['queued','active','paused'].includes(x.status)).sort((a,b)=>Date.parse(b.started_at||b.created_at)-Date.parse(a.started_at||a.created_at)).slice(0,5);
  $('.dashboard-queue-panel').hidden=!active.length;
  $('#active-list').innerHTML=active.length?active.map(ticket=>`<div class="dashboard-queue-item"><span class="queue-status ${esc(ticket.status)}">${esc(statusLabels[ticket.status])}</span><div class="queue-details"><strong>${esc(ticket.ticket_no)}</strong><span>${esc(jobFor(ticket.job_type_id))} · ${esc(nameFor(ticket.assignee_id))}</span></div><time>${esc(fmt(ticket.started_at))}</time></div>`).join(''):`<div class="dashboard-queue-empty"><strong>ไม่มีงานรอเริ่ม กำลังทำ หรือพักอยู่</strong><span>งานที่ยังเปิดจะแสดงที่นี่</span></div>`;
}
function ticketHtml(t){
  const resolved=followupComplete(t,state.management?.cases);
  const status=resolved?'เบิกครบ':statusLabels[t.status]||t.status;
  const button=(action,label,primary=false)=>`<button type="button" class="${primary?'primary':'text-btn'}" data-action="${action}" data-id="${esc(t.id)}">${label}</button>`;
  let actions='';
  if(!t.deleted_at&&operator()){
    if(['active','paused'].includes(t.status)&&t.materials?.length)actions+=button('picks','บันทึกเบิกจริง');
    if(t.status==='queued')actions+=button('start','เริ่มงาน',true);
    if(t.status==='active')actions+=button('pause','พักงาน')+button('partial','เบิกไม่ครบ')+button('finish','จบงาน',true);
    if(t.status==='paused')actions+=button('resume','ทำงานต่อ',true)+button('partial','เบิกไม่ครบ');
  }
  if(supervisor()&&t.deleted_at){actions+=button('restore','กู้คืน')+button('purge','ลบถาวร');}
  if(supervisor()&&!t.deleted_at){
    if(t.status==='queued')actions+=button('start','เริ่มงาน',true);
    if(t.status==='active')actions+=button('finish','จบงาน',true);
    if(t.status==='paused')actions+=button('resume','ทำงานต่อ',true);
    actions+=button('edit','แก้ไข')+button('delete','ลบ');
    if(['active','paused','done','partial'].includes(t.status)&&t.materials?.length)actions+=button('edit-picks','แก้ไขเบิกจริง');
    if(['queued','active','paused'].includes(t.status))actions+=button('cancel','ยกเลิก');
  }
  actions+=button('history','ประวัติ');
  const timing=workBreakdown(t),completion=pickCompleteness(t);const duration=timing?`<br>ทำงานสุทธิ ${minutesText(timing.activeMinutes)}<br>พักในกะ ${minutesText(timing.waitingMinutes)} · รวม ${minutesText(timing.totalMinutes)}`:'';
  const varianceLines=(t.materials||[]).filter(line=>line.confirmed_at&&typeof line.actual_qty==='number'&&Math.abs(Math.round((line.actual_qty-Number(line.required_qty))*10000))>10000);
  const variance=varianceLines.length?`<section class="ticket-variance" aria-label="รายการเบิกขาดหรือเกิน"><h5>${resolved?'ประวัติส่วนต่าง · เบิกครบ':'รายการเบิกขาดหรือเกิน'} · ${varianceLines.length} รายการ</h5>${materialTable(varianceLines)}</section>`:'';
  const bom=`${t.fg_code?`<div class="ticket-fg"><strong>${esc(t.fg_code)} · ${esc(t.fg_name)}</strong><span>จำนวน ${qtyText(t.requested_qty)} FG</span></div>`:''}${Array.isArray(t.materials)&&t.materials.length?`<details class="ticket-materials" data-material-ticket="${esc(t.id)}"${expandedTickets.has(t.id)?' open':''}><summary>ดูรายการเบิก ${t.materials.length} รายการ${t.materials.some(line=>line.source==='stock')?' · มีรายการนอก BOM':''}</summary>${materialTable(t.materials)}</details>`:''}`;
  return `<article class="ticket"><div class="ticket-main"><div class="ticket-code">${esc(t.ticket_no)}</div><div class="ticket-document-count">${ticketDocumentCount(t)} ใบ · 1 งาน${ticketDocumentCount(t)>1?' · เวลาเริ่ม–จบชุดเดียว':''}</div><h4>${esc(jobFor(t.job_type_id))}</h4><div class="ticket-meta">${esc(nameFor(t.assignee_id))} · สร้าง ${fmt(t.created_at)}</div><div class="data-completeness ${completion.complete?'complete':'incomplete'}">${esc(completion.label)}</div>${documentSummary(t)}${bom}${variance}${t.description?`<p class="ticket-detail">${esc(t.description)}</p>`:''}${t.status_reason&&(!resolved||varianceLines.length)?`<p class="ticket-reason"><strong>${resolved?'เหตุผลตอนจบงาน:':'เหตุผล:'}</strong> ${esc(t.status_reason)}</p>`:''}</div><div class="ticket-right"><span class="status ${esc(resolved?'done':t.status)}">${t.deleted_at?'ลบแล้ว':status}</span>${resolved?'<p class="hint">ยอดเบิกจริงบันทึกครบแล้ว</p>':''}<div class="ticket-time">เริ่ม ${fmt(t.started_at)}<br>จบ ${fmt(t.ended_at)}${duration}</div><div class="ticket-actions">${actions}</div></div></article>`;
}
function ticketFilters(){return {query:$('#ticket-search').value,assigneeId:$('#ticket-person-filter').value,jobId:$('#ticket-job-filter').value,status:$('#ticket-filter').value==='all'?'':$('#ticket-filter').value,dateFrom:$('#ticket-date-from').value,dateTo:$('#ticket-date-to').value,dateBasis:$('#ticket-date-basis').value,completeness:$('#ticket-completeness').value};}
function setSelectOptions(select,html){if(select.dataset.optionsHtml!==html){select.innerHTML=html;select.dataset.optionsHtml=html;}}
function renderTicketFilterOptions(){
  for(const [selector,rows,placeholder,label] of [['#ticket-person-filter',state.people,'ทุกคน','display_name'],['#ticket-job-filter',state.jobs,'ทุกประเภทงาน','name']]){
    const select=$(selector),previous=select.value;
    setSelectOptions(select,`<option value="">${placeholder}</option>`+rows.map(row=>`<option value="${esc(row.id)}">${esc(row[label])}</option>`).join(''));
    select.value=previous;
  }
}
function selectedTickets(){return filterTickets($('#ticket-filter').value==='deleted'&&supervisor()?state.deletedTickets:reportingTickets(state.tickets,state.management?.cases),{...ticketFilters(),completeness:['short_pending','over_pending'].includes(ticketFilters().completeness)?'all':ticketFilters().completeness,status:['deleted','followup_complete','open'].includes($('#ticket-filter').value)?'':ticketFilters().status}).filter(t=>$('#ticket-filter').value!=='open'||['queued','active','paused'].includes(t.status)).filter(t=>$('#ticket-filter').value!=='followup_complete'||followupComplete(t,state.management?.cases)).filter(t=>ticketFilters().completeness!=='variance'||varianceRows([t],state.management?.cases).some(r=>r.status!=='resolved')).filter(t=>!['short_pending','over_pending'].includes(ticketFilters().completeness)||varianceRows([t],state.management?.cases).some(r=>r.status!=='resolved'&&(ticketFilters().completeness==='short_pending'?r.delta<0:r.delta>0))).map(t=>state.tickets.find(original=>original.id===t.id)||t);}
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
  $('#ticket-count').textContent=invalid?'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด':`${totalDocuments(list)} ใบ · ${list.length} งาน จาก ${filters.status==='deleted'?state.deletedTickets.length:state.tickets.length} รายการ`;
  $('#print-report-btn').disabled=!!invalid;
  $('#ticket-list').innerHTML=invalid?empty('กรุณาแก้ไขช่วงวันที่'):list.length?list.map(ticketHtml).join(''):empty('ไม่พบใบเบิกตามตัวกรอง');
}
function reportFiltersText(filters){
  const parts=[];
  if(filters.query.trim())parts.push(`เลขที่ใบเบิก: ${filters.query.trim()}`);
  if(filters.assigneeId)parts.push(`พนักงาน: ${nameFor(filters.assigneeId)}`);
  if(filters.jobId)parts.push(`Job: ${jobFor(filters.jobId)}`);
  if(filters.dateFrom||filters.dateTo)parts.push(`${dateBasisLabel(filters.dateBasis)}: ${filters.dateFrom||'ทั้งหมด'} ถึง ${filters.dateTo||'ทั้งหมด'}`);
  if(filters.status)parts.push(`สถานะ: ${(filters.status==='followup_complete'?'เบิกครบ · จัดการติดตามแล้ว':statusLabels[filters.status]||filters.status)}`);
  return parts.length?parts.join(' · '):'ทุกใบเบิก';
}
function populateReport(list,filters){
  const counts={queued:0,active:0,paused:0,done:0,partial:0,cancelled:0};list.forEach(ticket=>{const status=followupComplete(ticket,state.management?.cases)?'done':ticket.status;if(status in counts)counts[status]+=ticketDocumentCount(ticket);});
  const rows=list.map((ticket,index)=>{
    const materials=Array.isArray(ticket.materials)&&ticket.materials.length?`<strong>รายการวัสดุ</strong><div>${ticket.materials.map(line=>`<span>${line.source==='stock'?'[นอก BOM] ':''}${esc(line.pk_code)} ${esc(line.pk_name)}: ${qtyText(line.required_qty)} ${esc(line.unit)} · ${line.confirmed_at?`เบิกจริง ${qtyText(line.actual_qty)} · ${esc(pickVarianceText(line.required_qty,line.actual_qty,line.unit,qtyText))} ${esc(Math.abs(Math.round((line.actual_qty-Number(line.required_qty))*10000))>10000?line.short_reason||'':'')}`:'ยังไม่ยืนยันเบิกจริง'}</span>`).join('')}</div>`:'';
    const detail=materials||ticket.description||ticket.status_reason?`<tr class="report-materials"><td colspan="10">${materials}<p>${esc(pickCompleteness(ticket).label)}</p>${documentSummary(ticket)}${ticket.description?`<p><strong>หมายเหตุ:</strong> ${esc(ticket.description)}</p>`:''}${ticket.status_reason&&(!followupComplete(ticket,state.management?.cases)||ticket.materials?.some(l=>l.confirmed_at&&Math.abs(Math.round((l.actual_qty-Number(l.required_qty))*10000))>10000))?`<p><strong>เหตุผลสถานะ:</strong> ${esc(ticket.status_reason)}</p>`:''}</td></tr>`:'';
    const status=followupComplete(ticket,state.management?.cases)?'เบิกครบ':statusLabels[ticket.status]||ticket.status;
    return `<tbody class="report-ticket"><tr><td>${index+1}</td><td><strong>${esc(ticket.ticket_no)}</strong><br>${ticketDocumentCount(ticket)} ใบ · 1 งาน</td><td>${esc(fmtReport(ticket.created_at))}</td><td>${esc(nameFor(ticket.assignee_id))}</td><td>${esc(jobFor(ticket.job_type_id))}</td><td>${ticket.fg_code?`${esc(ticket.fg_code)}<br>${esc(ticket.fg_name||'')}<br><strong>${qtyText(ticket.requested_qty)} FG</strong>`:'—'}</td><td>${esc(status)}</td><td>${esc(fmtReport(ticket.started_at))}</td><td>${esc(fmtReport(ticket.ended_at))}</td><td>${esc(minutesText(workBreakdown(ticket)?.activeMinutes??null))}</td></tr>${detail}</tbody>`;
  }).join('');
  $('#print-report').innerHTML=`<header><img src="assets/bcl-logo.png" alt="BCL"><div><h1>รายงานใบเบิกของ</h1><p>พิมพ์เมื่อ ${esc(fmtReport(new Date()))} · เวลาไทย (UTC+7)</p></div></header><div class="report-filter-line"><strong>ตัวกรอง:</strong> ${esc(reportFiltersText(filters))}</div><div class="report-summary"><span>ทั้งหมด <strong>${totalDocuments(list)} ใบ · ${list.length} งาน</strong></span>${Object.entries(counts).map(([key,count])=>`<span>${statusLabels[key]} <strong>${count}</strong></span>`).join('')}</div><table class="report-table"><thead><tr><th>#</th><th>เลขที่ใบเบิก</th><th>วันที่สร้าง</th><th>พนักงาน</th><th>ประเภทงาน</th><th>FG / จำนวน</th><th>สถานะ</th><th>เริ่ม</th><th>สิ้นสุด</th><th>เวลาสุทธิ<br>(หักพัก/นอกกะ)</th></tr></thead>${rows||'<tbody><tr><td colspan="10">ไม่พบใบเบิกตามตัวกรอง</td></tr></tbody>'}</table><p class="report-note">จำนวนวัสดุคำนวณตาม BOM ที่บันทึกกับใบเบิก ไม่ใช่หลักฐานการตัดสต็อก · เวลาสุทธิคิดเฉพาะกะ 08:00–17:00 หักพักเที่ยงและช่วงพักงานโดยไม่หักซ้ำ</p>`;
}
function printReport(){const list=selectedTickets();populateReport(list,ticketFilters());document.body.classList.add('print-tickets');window.print();}
function renderPeople(){$('#people-list').innerHTML=state.people.length?state.people.map(p=>`<div class="person-row"><div class="matrix-person">${personPortrait(p)}<div class="staff-identity"><strong>${esc(p.display_name)}</strong><small>${esc(p.position||'ยังไม่ระบุตำแหน่ง')}</small></div></div><div class="person-controls"><button type="button" class="text-btn" data-edit-person="${esc(p.id)}">แก้ไขข้อมูล</button><label class="staff-photo-button">เปลี่ยนรูป<input type="file" accept="image/jpeg,image/png,image/webp" data-staff-photo="${esc(p.id)}" aria-label="เปลี่ยนรูป ${esc(p.display_name)}"></label><label class="hint"><input type="checkbox" data-active="${esc(p.id)}" ${p.active?'checked':''}> เปิดใช้งาน</label></div></div>`).join(''):empty('ยังไม่มีพนักงาน');}
function renderSettings(){renderStandards();if($('#skill-editor').contains(document.activeElement))return;const people=state.people.filter(p=>p.active),jobs=state.jobs.filter(j=>j.active);$('#job-list').innerHTML=state.jobs.length?state.jobs.map(j=>`<div class="job-row"><strong>${esc(j.name)}</strong><label class="hint"><input type="checkbox" data-job-active="${esc(j.id)}" ${j.active?'checked':''}> เปิดใช้งาน</label></div>`).join(''):empty('ยังไม่มีประเภทงาน');$('#skill-editor').innerHTML=!people.length||!jobs.length?empty('เพิ่มพนักงานและประเภทงานก่อนกำหนดทักษะ'):`<div class="matrix-wrap"><table class="skill-edit-table"><thead><tr><th>พนักงาน</th><th>ประเภทงาน</th><th>ระดับทักษะ</th></tr></thead><tbody>${people.flatMap(p=>jobs.map(j=>{const level=state.skills.find(s=>s.profile_id===p.id&&s.job_type_id===j.id)?.level||0;return `<tr><td>${esc(p.display_name)}</td><td>${esc(j.name)}</td><td><select data-skill="${esc(p.id)}" data-job="${esc(j.id)}">${['ยังไม่ประเมิน','1 · เริ่มต้น','2 · ทำได้','3 · ชำนาญ','4 · สอนงานได้'].map((label,i)=>`<option value="${i}" ${i===level?'selected':''}>${label}</option>`).join('')}</select></td></tr>`})).join('')}</tbody></table></div>`;}
async function mutate(fn,args,success,errorTarget){return saveOnce(fn+':'+(args.p_ticket_id||args.p_staff_id||''),async()=>{
  try{
    const {error}=await workAction(fn,args);
    if(error)throw error;
  }catch(error){const message=saveErrorText(error);if(errorTarget)$(errorTarget).textContent=message;else notice(message,true);return false;}
  if(errorTarget)$(errorTarget).textContent='';notice(success);
  try{await load(true);}catch{syncLabel('บันทึกแล้ว · โหลดข้อมูลล่าสุดไม่สำเร็จ');}
  return true;
});}
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
  form.elements.ticket_no.value=ticket.ticket_no;updateDocumentCount(form.elements.ticket_no);
  form.elements.job_type_id.innerHTML=state.jobs.filter(j=>j.active||j.id===ticket.job_type_id).map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');
  form.elements.assignee_id.innerHTML=state.people.filter(p=>p.active||p.id===ticket.assignee_id).map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');
  form.elements.job_type_id.value=ticket.job_type_id;form.elements.assignee_id.value=ticket.assignee_id;
  form.elements.description.value=ticket.description||'';
  form.elements.requested_qty.value=ticket.requested_qty||'';
  form.elements.requested_qty.disabled=!ticket.fg_code;form.dataset.hasFg=String(!!ticket.fg_code);renderDocuments(form,ticket.documents||[]);
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
  $('#history-list').innerHTML=data?.length?data.map(event=>`<article class="history-event"><div class="history-event-head"><strong>${esc(eventLabels[event.event_type]||event.event_type)}</strong><time>${esc(fmt(event.created_at))}</time></div><div class="history-actor">${esc(event.actor_role==='supervisor'?'หัวหน้า':event.actor_role==='operator'?'ผู้ปฏิบัติงาน':'ระบบ')} · ${esc(event.actor_username)}${event.actor_display_name?' · ผู้ทำรายการ: '+esc(event.actor_display_name):' · ไม่ได้ระบุตัวผู้ทำรายการ'}</div>${event.reason?`<p><strong>เหตุผล:</strong> ${esc(event.reason)}</p>`:''}${['edited','completed','partial'].includes(event.event_type)?`<ul>${historyChanges(event)}</ul>`:''}</article>`).join(''):empty('ยังไม่มีประวัติ');
}

document.addEventListener('click',async e=>{
  const editPerson=e.target.closest('[data-edit-person]');if(editPerson&&supervisor()){const person=state.people.find(p=>p.id===editPerson.dataset.editPerson);if(person){$('#staff-edit-form [name=staff_id]').value=person.id;$('#staff-edit-form [name=name]').value=person.display_name;$('#staff-edit-form [name=position]').value=person.position||'';editingStaffSnapshot=[person.display_name,person.position||''];$('#staff-edit-message').textContent='';$('#staff-edit-dialog').showModal();}return;}
  const removeStock=e.target.closest('[data-remove-stock]');if(removeStock){state.stockLines.splice(Number(removeStock.dataset.removeStock),1);renderStockLines();return;}
  const nav=e.target.closest('#nav button[data-view]');if(nav){if(nav.dataset.view==='trash'&&!supervisor())return;showView(nav.dataset.view);return;}
  if(e.target.closest('[data-dashboard-tickets]')){$('#ticket-date-basis').value=$('#dashboard-date-basis').value;$('#ticket-date-from').value=$('#dashboard-from').value;$('#ticket-date-to').value=$('#dashboard-to').value;$('#ticket-job-filter').value=$('#dashboard-job').value;$('#ticket-search').value='';$('#ticket-person-filter').value='';$('#ticket-filter').value='all';$('#ticket-completeness').value='all';renderTickets();showView('tickets');return;}
  const action=e.target.closest('button[data-action]');if(action){
    const kind=action.dataset.action,ticket=[...state.tickets,...state.deletedTickets].find(t=>t.id===action.dataset.id);
    if(!ticket)return;
    if(kind==='purge'&&supervisor()){openPurge(ticket);return;}
    if((operator()||supervisor())&&['picks','finish','partial'].includes(kind)&&ticket.materials?.length){openPicks(ticket,kind==='finish'?'done':kind==='partial'?'partial':null);return;}
    if(kind==='edit-picks'&&supervisor()){openPicks(ticket,null,true);return;}
    if(kind==='history'){await openHistory(ticket);return;}
    if(kind==='edit'&&supervisor()){openEdit(ticket);return;}
    if(kind==='resume'&&supervisor()){action.disabled=true;try{await mutate('resume_ticket_as_supervisor',{p_ticket_id:ticket.id,p_reason:'หัวหน้าสั่งทำงานต่อ'},'ทำงานต่อแล้ว');}finally{action.disabled=false;}return;}
    if(kind in eventConfig){if((['cancel','delete','restore'].includes(kind)&&supervisor())||(!['cancel','delete','restore'].includes(kind)&&operator()))openEvent(kind,ticket);return;}
    if(['start','finish'].includes(kind)&&(operator()||supervisor())){
      action.disabled=true;
      await mutate((kind==='start'?'start_ticket_as_':'finish_ticket_as_')+(supervisor()?'supervisor':'operator'),{p_ticket_id:ticket.id},kind==='start'?'เริ่มงานแล้ว':'จบงานแล้ว');
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
  const numberError=ticketNumbersError(f.get('ticket_no'));if(numberError){$('#ticket-edit-message').textContent=numberError;return;}
  const qty=ticket.fg_code?Number(e.target.elements.requested_qty.value):null,reason=String(f.get('reason')||'').trim();
  if(!reason||ticket.fg_code&&(!Number.isFinite(qty)||qty<=0||qty>1000000||Math.round(qty*1000)!==qty*1000)){$('#ticket-edit-message').textContent='กรุณาระบุเหตุผลและจำนวนสินค้าสำเร็จรูป (FG) ที่ถูกต้อง';return;}
  const startValue=e.target.elements.started_at.value,endValue=e.target.elements.ended_at.value;
  const startedAt=fromBangkokInput(startValue,ticket.started_at),endedAt=fromBangkokInput(endValue,ticket.ended_at);
  const timeError=(startValue&&!startedAt||endValue&&!endedAt)?'รูปแบบเวลาไม่ถูกต้อง':timeEditError(ticket.status,startedAt,endedAt,Date.now(),ticket.started_at);
  if(timeError){$('#ticket-edit-message').textContent=timeError;return;}
  const documentError=documentsError(readDocuments(e.target),qty,!!ticket.fg_code);if(documentError){$('#ticket-edit-message').textContent=documentError;return;}
  const args={p_documents:readDocuments(e.target),p_ticket_id:editingTicketId,p_ticket_no:String(f.get('ticket_no')).trim(),p_job_type_id:f.get('job_type_id'),p_assignee_id:f.get('assignee_id'),p_description:String(f.get('description')||'').trim(),p_requested_qty:qty,p_started_at:startedAt,p_ended_at:endedAt,p_reason:reason};
  if(await mutate('edit_ticket_with_times_as_supervisor',args,'แก้ไขใบเบิกและบันทึกประวัติแล้ว','#ticket-edit-message')){$('#ticket-edit-dialog').close();editingTicketId=null;}
});
function clearRole(){management.clear();state.role='';state.username='';state.code='';state.verified=false;state.actorId='';['workRole','workUsername','workCode','workActorId'].forEach(key=>sessionStorage.removeItem(key));}
$('#edit-btn').addEventListener('click',()=>{if(editing()){clearRole();updateMode();notice('ออกจากโหมดทำงานแล้ว');}else {refreshActorOptions();$('#code-dialog').showModal();}});
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
$('#code-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),role=String(f.get('role')),actorId=String(f.get('actor_id')||'');if(role==='operator'&&!actorId){$('#code-message').textContent='กรุณาเลือกผู้ทำรายการ';return;}const username=String(f.get('username')).trim(),code=String(f.get('code'));const {data,error}=await state.db.rpc('verify_role_code',{p_role:role,p_username:username,p_code:code});if(error||!data){$('#code-message').textContent='ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';return;}state.actorId=actorId;sessionStorage.setItem('workActorId',actorId);state.role=role;state.username=username;state.code=code;state.verified=true;sessionStorage.setItem('workRole',role);sessionStorage.setItem('workUsername',username);sessionStorage.setItem('workCode',code);e.target.reset();$('#code-message').textContent='';$('#code-dialog').close();updateMode();await load(true);notice(role==='supervisor'?'เข้าสู่โหมดหัวหน้าแล้ว':role==='clerk'?'เข้าสู่โหมดธุรการแล้ว':'เข้าสู่โหมดปฏิบัติงานแล้ว');});
$('#refresh-btn').addEventListener('click',()=>load());
['#ticket-search','#ticket-date-from','#ticket-date-to'].forEach(selector=>$(selector).addEventListener('input',renderTickets));
['#ticket-person-filter','#ticket-job-filter','#ticket-filter','#ticket-date-basis','#ticket-completeness'].forEach(selector=>$(selector).addEventListener('change',renderTickets));
$('#clear-ticket-filters').addEventListener('click',()=>{['#ticket-search','#ticket-person-filter','#ticket-job-filter','#ticket-date-from','#ticket-date-to'].forEach(selector=>$(selector).value='');$('#ticket-filter').value='all';renderTickets();});
$('#print-report-btn').addEventListener('click',printReport);
window.addEventListener('beforeprint',()=>{if(document.body.classList.contains('print-tickets'))populateReport(selectedTickets(),ticketFilters());});
window.addEventListener('afterprint',()=>document.body.classList.remove('print-tickets'));
$('#new-ticket-btn').addEventListener('click',async()=>{
  const jobs=state.jobs.filter(j=>j.active),people=state.people.filter(p=>p.active);
  if(!jobs.length||!people.length){notice('ต้องมีประเภทงานและพนักงานก่อนสร้างใบเบิก',true);return;}
  state.bom=null;state.selectedFormulaCode='';state.stockLines=[];$('#ticket-form').reset();updateDocumentCount($('#ticket-form [name="ticket_no"]'));
  $('#ticket-no-message').textContent='';$('#ticket-no-suggestion').hidden=true;$('#ticket-no-existing').hidden=true;$('#ticket-form [name="ticket_no"]').removeAttribute('aria-invalid');
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
$('#ticket-no-existing').addEventListener('click',e=>{
  const button=e.currentTarget;$('#ticket-dialog').close();
  $('#ticket-search').value=button.dataset.number;$('#ticket-filter').value=button.dataset.deleted==='true'?'deleted':'all';
  $('#ticket-person-filter').value='';$('#ticket-job-filter').value='';$('#ticket-date-from').value='';$('#ticket-date-to').value='';$('#ticket-completeness').value='all';
  if(button.dataset.deleted==='true'){$('#trash-search').value=button.dataset.number;renderTrash();showView('trash');}
  else {showView('tickets');renderTickets();}
});
$('#bom-results').addEventListener('click',e=>{
  const choice=e.target.closest('[data-bom-choice]');
  if(!choice)return;
  $('#bom-search').value=choice.dataset.bomChoice;
  renderBomOptions();
  $('#ticket-form [data-document-number] input')?.focus();
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
  if(!manual&&(!formula||!Number.isFinite(qty)||qty<=0||qty>1000000||Math.round(qty*1000)!==qty*1000)){notice('เลือกสูตรและใส่จำนวนสินค้าสำเร็จรูป (FG) ที่ถูกต้อง',true);return;}
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
  const documentError=documentsError(readDocuments(e.target),qty,!manual);if(documentError){notice(documentError,true);return;}args.p_documents=readDocuments(e.target);
  const {error}=await workAction('create_withdrawal_ticket_as_supervisor',args);
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
 if(name&&await mutate('add_staff_profile_as_supervisor',{p_name:name,p_position:form.elements.position.value.trim(),p_photo:photo},'เพิ่มพนักงานแล้ว','#staff-photo-message')){form.reset();$('#staff-photo-preview').hidden=true;}
 }catch(error){$('#staff-photo-message').textContent=error.message;}finally{button.disabled=false;}
});
document.addEventListener('change',async e=>{
 if(!e.target.matches('[data-staff-photo]')||!supervisor()||!e.target.files[0])return;
 const input=e.target;input.disabled=true;
 try{const photo=await prepareStaffPhoto(input.files[0]);await mutate('set_staff_photo_as_supervisor',{p_staff_id:input.dataset.staffPhoto,p_photo:photo},'เปลี่ยนรูปพนักงานแล้ว');}catch(error){notice(error.message,true);}finally{input.disabled=false;input.value='';}
});
$('#job-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(name&&await mutate('add_job_as_supervisor',{p_name:name},'เพิ่มประเภทงานแล้ว'))e.target.reset();});
document.addEventListener('change',async e=>{let fn,args;if(e.target.matches('[data-active]')){fn='set_staff_active_as_supervisor';args={p_staff_id:e.target.dataset.active,p_active:e.target.checked};}else if(e.target.matches('[data-job-active]')){fn='set_job_active_as_supervisor';args={p_job_id:e.target.dataset.jobActive,p_active:e.target.checked};}else if(e.target.matches('[data-skill]')){fn='set_skill_rating_as_supervisor';args={p_staff_id:e.target.dataset.skill,p_job_id:e.target.dataset.job,p_level:Number(e.target.value)};}else return;await mutate(fn,args,'บันทึกแล้ว');});

async function boot(){if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY){syncLabel('ยังไม่ตั้งค่าฐานข้อมูล');notice('ยังไม่ได้ตั้งค่าฐานข้อมูลกลาง',true);return;}state.db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});if(state.role&&state.username&&state.code){const {data,error}=await state.db.rpc('verify_role_code',{p_role:state.role,p_username:state.username,p_code:state.code});if(!error&&data&&!(state.role==='operator'&&!state.actorId))state.verified=true;else clearRole();}updateMode();await load();setInterval(()=>{if(!document.hidden)load(true)},15000);}

let pendingPicks=null;
function openPicks(ticket,closeStatus,supervisorEdit=false){
 pendingPicks={id:ticket.id,materials:structuredClone(ticket.materials),status:ticket.status,closeStatus,supervisorEdit,supervisorAction:supervisor()&&!supervisorEdit};
 $('#pick-title').textContent=(supervisorEdit?'แก้ไขเบิกจริง':closeStatus==='done'?'ยืนยันและจบงาน':closeStatus==='partial'?'ยืนยันและปิดเบิกไม่ครบ':'บันทึกเบิกจริง')+' · '+ticket.ticket_no;
 $('#pick-message').textContent='';$('#pick-save').textContent=supervisorEdit?'บันทึกการแก้ไข':closeStatus?'บันทึกและปิดงาน':'บันทึกเบิกจริง';
 $('#pick-edit-reason-wrap').hidden=!supervisorEdit;$('#pick-edit-reason').required=supervisorEdit;$('#pick-edit-reason').value='';
 $('#pick-edit-hint').hidden=!(supervisorEdit&&['done','partial'].includes(ticket.status));
 $('#pick-lines').innerHTML=ticket.materials.map((l,i)=>`<fieldset class="pick-line"><legend>${i+1}. ${esc(l.pk_code)}</legend><p>${esc(l.pk_name)}</p><p>ต้องเบิก <strong>${qtyText(l.required_qty)} ${esc(l.unit)}</strong></p><div class="pick-quantity-fields"><label><span>จำนวนเบิกจริง (${esc(l.unit)})</span><input aria-label="เบิกจริงรายการ ${i+1}" data-pick-qty="${i}" type="number" required min="0" max="1000000000" step="0.0001" value="${defaultPickActual(l)}"></label></div><button class="text-btn" type="button" data-pick-full="${i}">เบิกครบรายการนี้</button><p data-pick-short="${i}" class="hint"></p><label>ประเภทเหตุผล<select data-pick-cause="${i}" aria-label="ประเภทเหตุผลรายการ ${i+1}"><option value="">เลือกเมื่อส่วนต่างตั้งแต่ 1 หน่วย</option>${Object.entries(reasonLabels).map(([code,label])=>`<option value="${code}" ${l.reason_code===code?'selected':''}>${label}</option>`).join('')}</select></label><label>รายละเอียดเหตุผล (บังคับเมื่อส่วนต่างตั้งแต่ 1 หน่วย)<textarea aria-label="เหตุผลรายการ ${i+1}" data-pick-reason="${i}" maxlength="1000">${esc(l.short_reason||'')}</textarea></label></fieldset>`).join('');
 updatePickShorts();$('#pick-dialog').showModal();
}
function readPickActual(i){return actualFromInput(pendingPicks.materials[i].required_qty,$('[data-pick-qty="'+i+'"]').value);}
function updatePickShorts(){if(!pendingPicks)return;pendingPicks.materials.forEach((l,i)=>{const qty=readPickActual(i);$('[data-pick-short="'+i+'"]').textContent=qty===null?'ยังไม่ยืนยัน':!Number.isFinite(qty)||qty<0?'จำนวนไม่ถูกต้อง':'เบิกจริง '+qtyText(qty)+' '+l.unit+' · '+pickVarianceText(l.required_qty,qty,l.unit,qtyText);$('[data-pick-reason="'+i+'"]').required=qty!==null&&Math.abs(Math.round((qty-Number(l.required_qty))*10000))>=10000;$('[data-pick-cause="'+i+'"]').required=qty!==null&&Math.abs(Math.round((qty-Number(l.required_qty))*10000))>=10000;});updatePickClosure();}
function updatePickClosure(){
 const p=pendingPicks,summary=$('#pick-close-summary');summary.hidden=!p?.closeStatus&&!(p?.supervisorEdit&&['done','partial'].includes(p.status));
 if(summary.hidden)return;
 const picks=p.materials.map((_,i)=>({actual_qty:readPickActual(i)})),status=automaticPickCloseStatus(p.materials,picks,'done');
 summary.textContent='สถานะปิดงานอัตโนมัติ: '+(status==='partial'?'เบิกไม่ครบ — มีรายการขาด':'เบิกครบ — ไม่มีรายการขาดเกิน 1 หน่วย');
 if(!p.supervisorEdit)$('#pick-save').textContent=status==='partial'?'บันทึกและปิดเป็นเบิกไม่ครบ':'บันทึกและจบงาน';
}
$('#pick-lines').addEventListener('input',updatePickShorts);
$('#pick-lines').addEventListener('change',updatePickShorts);
$('#pick-lines').addEventListener('click',e=>{const b=e.target.closest('[data-pick-full]');if(b){const i=Number(b.dataset.pickFull);$('[data-pick-qty="'+i+'"]').value=pendingPicks.materials[i].required_qty;updatePickShorts();}});
$('#pick-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!pendingPicks||!((pendingPicks.supervisorEdit||pendingPicks.supervisorAction)?supervisor():operator()))return;
 const p=pendingPicks,picks=p.materials.map((l,i)=>({actual_qty:readPickActual(i),reason_code:$('[data-pick-cause="'+i+'"]').value,short_reason:$('[data-pick-reason="'+i+'"]').value.trim()}));
 const closeStatus=p.supervisorEdit?null:automaticPickCloseStatus(p.materials,picks,p.closeStatus);
 const error=pickError(p.materials,picks,closeStatus);if(error){$('#pick-message').textContent=error;return;}
 $('#pick-save').disabled=true;
 const args={p_ticket_id:p.id,p_expected_materials:p.materials,p_expected_status:p.status,p_picks:picks,...(p.supervisorEdit?{p_edit_reason:$('#pick-edit-reason').value.trim()}:{p_close_status:closeStatus})};
 try{if(await mutate(p.supervisorEdit?'edit_ticket_picks_as_supervisor':p.supervisorAction?'confirm_ticket_picks_as_supervisor':'confirm_ticket_picks_as_operator',args,p.supervisorEdit?'แก้ไขเบิกจริงและบันทึกประวัติแล้ว':p.closeStatus?'บันทึกเบิกจริงและปิดงานแล้ว':'บันทึกเบิกจริงแล้ว','#pick-message'))$('#pick-dialog').close();}finally{$('#pick-save').disabled=false;}
});
$('#staff-edit-form').addEventListener('submit',async e=>{e.preventDefault();if(!supervisor())return;const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;try{if(await mutate('edit_staff_profile_as_supervisor',{p_staff_id:form.elements.staff_id.value,p_name:form.elements.name.value.trim(),p_position:form.elements.position.value.trim(),p_expected:editingStaffSnapshot},'แก้ไขข้อมูลพนักงานแล้ว','#staff-edit-message'))$('#staff-edit-dialog').close();}finally{button.disabled=false;}});
$('#dashboard-period').addEventListener('change',renderDashboard);
$('#dashboard-job').addEventListener('change',renderDashboard);
['#dashboard-from','#dashboard-to'].forEach(s=>$(s).addEventListener('change',()=>{$('#dashboard-period').value='custom';renderDashboard();}));
$('#dashboard-reset').addEventListener('click',()=>{$('#dashboard-period').value='all';$('#dashboard-job').value='';$('#dashboard-date-basis').value='ended_at';renderDashboard();});

$('#ticket-edit-form [name="ticket_no"]').addEventListener('input',e=>updateDocumentCount(e.target));

function dateBasisLabel(basis){return {created_at:'วันที่สร้างงาน',started_at:'วันที่เริ่มงาน',ended_at:'วันที่จบงาน'}[basis]||'วันที่สร้างงาน';}
async function workAction(action,args){
  return state.db.rpc('perform_work_action',{p_username:state.username,p_code:state.code,p_role:state.role,p_actor_id:state.role==='operator'?state.actorId||null:null,p_action:action,p_args:args});
}
function refreshActorOptions(){
  setSelectOptions($('#actor-select'),'<option value="">เลือกชื่อผู้ทำรายการ</option>'+state.people.filter(p=>p.active).map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join(''));
  const operatorRole=$('#role-select').value==='operator';$('#actor-field').hidden=!operatorRole;$('#actor-select').required=operatorRole;
}
$('#role-select').addEventListener('change',refreshActorOptions);
function readDocuments(form){return [...form.querySelectorAll('[data-document-number]')].map(row=>({number:row.dataset.documentNumber,quantity:row.querySelector('input')?(row.querySelector('input').value===''?null:Number(row.querySelector('input').value)):null}));}
function renderDocuments(form,initial=null){
  const container=form.querySelector('[data-document-rows]');if(!container)return;
  const hasFg=form.dataset.hasFg==='true',refs=ticketReferences({ticket_no:form.elements.ticket_no.value,fg_code:hasFg?'selected':null});
  const previous=initial||readDocuments(form),map=new Map(previous.map(row=>[row.number.toUpperCase(),row.quantity]));
  container.innerHTML=refs.map((number,i)=>`<div class="document-row" data-document-number="${esc(number)}"><strong>${esc(number)}</strong>${hasFg?`<label>จำนวนผลิตใบที่ ${i+1} (FG)<input type="number" aria-label="จำนวนผลิตใบที่ ${i+1}" min="0.001" max="1000000" step="0.001" required value="${map.get(number.toUpperCase())??''}"></label>`:'<span>ใช้รายการวัสดุรวมของงาน</span>'}</div>`).join('');
  form.elements.requested_qty.readOnly=hasFg;
  updateDocumentTotal(form);
}
function updateDocumentTotal(form){
  if(form.dataset.hasFg!=='true')return;
  const rows=readDocuments(form),sum=rows.reduce((s,r)=>s+Number(r.quantity||0),0);
  form.elements.requested_qty.value=sum>0?Math.round(sum*1000)/1000:'';
  if(form.id==='ticket-form')renderBomPreview();
}
for(const id of ['ticket-form','ticket-edit-form'])$('#'+id).addEventListener('input',e=>{if(e.target.closest('[data-document-number]'))updateDocumentTotal(e.currentTarget);});
function documentSummary(ticket){
  const rows=ticket.documents||[];
  if(!rows.length||!ticket.fg_code)return '';
  return `<div class="document-summary">${rows.map(r=>`<span><strong>${esc(r.number)}</strong>: ${r.quantity===null?'ยังไม่ระบุจำนวนผลิตรายใบ':qtyText(r.quantity)+' FG'}</span>`).join('')}</div>`;
}
function renderAttention(){
  const all=reportingTickets(state.tickets,state.management?.cases);
  const pending=varianceRows(all,state.management?.cases).filter(r=>r.status!=='resolved');
  const items=[['all','ยังบันทึกยอดเบิกจริงไม่ครบ',all.filter(t=>t.status!=='cancelled'&&pickCompleteness(t).total&&!pickCompleteness(t).complete).length,'incomplete'],['all','มีวัสดุขาดที่ยังไม่จัดการ',new Set(pending.filter(r=>r.delta<0).map(r=>r.ticket.id)).size,'short_pending'],['all','มีวัสดุเกินที่ยังไม่จัดการ',new Set(pending.filter(r=>r.delta>0).map(r=>r.ticket.id)).size,'over_pending']].filter(([, ,count])=>count>0);
  $('#attention-list').hidden=!items.length;
  $('#attention-list').innerHTML='<p>เรื่องที่ต้องติดตาม · ทุกวันที่ (ไม่จำกัดตามตัวกรองด้านบน)</p>'+items.map(([status,label,count,completeness])=>`<button class="attention-card" data-attention-status="${status}" data-attention-completeness="${completeness}" type="button"><span>${label}</span><strong>${count} งาน</strong><small>เปิดใบเบิก →</small></button>`).join('')+'<p class="attention-note">งานเดียวอาจมีทั้งขาดและเกิน จึงไม่ควรบวกยอดติดตามเข้าด้วยกัน</p>';
}
document.addEventListener('click',e=>{
  const attention=e.target.closest('[data-attention-status]');
  const metric=e.target.closest('[data-metric-status]');if(!attention&&!metric)return;
  $('#ticket-search').value='';$('#ticket-person-filter').value='';$('#ticket-job-filter').value=attention?'':$('#dashboard-job').value;
  $('#ticket-date-basis').value=attention?'created_at':$('#dashboard-date-basis').value;
  $('#ticket-date-from').value=attention?'':$('#dashboard-from').value;$('#ticket-date-to').value=attention?'':$('#dashboard-to').value;
  $('#ticket-filter').value=attention?attention.dataset.attentionStatus:metric.dataset.metricStatus;
  $('#ticket-completeness').value=attention?attention.dataset.attentionCompleteness:'all';renderTickets();showView('tickets');
});
$('#dashboard-date-basis').addEventListener('change',renderDashboard);
function renderStandards(){
  const form=$('#standard-form');setSelectOptions(form.elements.job_id,state.jobs.filter(j=>j.active).map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join(''));
  $('#standards-list').innerHTML=state.standards.length?state.standards.map(s=>`<div class="standard-row"><strong>${esc(jobFor(s.job_type_id))} · ${esc(s.fg_code||'งานไม่มีสูตร')}</strong><span>เตรียม ${qtyText(s.setup_minutes)} นาที + ${qtyText(s.minutes_per_line)} นาที/รายการ + ${qtyText(s.minutes_per_1000_fg)} นาที/1,000 FG</span><button type="button" class="text-btn" data-edit-standard="${esc(s.job_type_id)}" data-standard-fg="${esc(s.fg_code)}">แก้ไข</button></div>`).join(''):empty('ยังไม่มีเวลามาตรฐาน จึงยังไม่คำนวณคะแนนความเร็ว');
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit-standard]');if(!b)return;const s=state.standards.find(s=>s.job_type_id===b.dataset.editStandard&&s.fg_code===b.dataset.standardFg),f=$('#standard-form');f.elements.job_id.value=s.job_type_id;f.elements.fg_code.value=s.fg_code;f.elements.setup.value=s.setup_minutes;f.elements.line.value=s.minutes_per_line;f.elements.fg.value=s.minutes_per_1000_fg;f.elements.setup.focus();});
$('#standard-form').addEventListener('submit',async e=>{e.preventDefault();if(!supervisor())return;const f=e.target,button=f.querySelector('[type=submit]'),values=['setup','line','fg'].map(key=>Number(f.elements[key].value));if(values.some(v=>!Number.isFinite(v)||v<0)||values.reduce((a,b)=>a+b,0)<=0){$('#standard-message').textContent='กำหนดเวลามาตรฐานอย่างน้อยหนึ่งช่องมากกว่า 0';return;}button.disabled=true;try{await mutate('set_work_standard_as_supervisor',{p_job_id:f.elements.job_id.value,p_fg_code:f.elements.fg_code.value.trim(),p_setup:values[0],p_line:values[1],p_fg:values[2]},'บันทึกเวลามาตรฐานแล้ว','#standard-message');}finally{button.disabled=false;}});
let pendingPurge=null;
function renderTrash(){
  if(!supervisor())return;
  $('#trash-list').querySelectorAll('[data-material-ticket]').forEach(details=>{if(details.open)expandedTickets.add(details.dataset.materialTicket);else expandedTickets.delete(details.dataset.materialTicket);});
  const query=$('#trash-search').value.trim().toLocaleLowerCase();
  const list=state.deletedTickets.filter(t=>[t.ticket_no,nameFor(t.assignee_id),jobFor(t.job_type_id)].join(' ').toLocaleLowerCase().includes(query));
  $('#trash-count').textContent=`${list.length} งาน · ${totalDocuments(list)} ใบ`;
  $('#trash-list').innerHTML=list.length?list.map(ticketHtml).join(''):empty(query?'ไม่พบใบเบิกในถังขยะตามคำค้น':'ถังขยะว่าง');
}
function openPurge(ticket){
  pendingPurge={...ticket};$('#purge-form').reset();$('#purge-message').textContent='';$('#purge-ticket').textContent=`ใบเบิก ${ticket.ticket_no}`;$('#purge-dialog').showModal();
}
$('#trash-search').addEventListener('input',renderTrash);
$('#purge-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!supervisor()||!pendingPurge)return;
  const form=e.currentTarget,ticket=pendingPurge,confirmation=form.elements.confirmation.value,reason=form.elements.reason.value.trim();
  const error=purgeConfirmationError(ticket,confirmation,reason);if(error){$('#purge-message').textContent=error;return;}
  const button=form.querySelector('[type=submit]');button.disabled=true;
  try{if(await mutate('purge_ticket_as_supervisor',{p_ticket_id:ticket.id,p_expected_deleted_at:ticket.deleted_at,p_confirm_number:confirmation.trim(),p_reason:reason},'ลบถาวรแล้ว เลขใบเบิกกลับมาใช้ใหม่ได้','#purge-message')){$('#purge-dialog').close();pendingPurge=null;expandedTickets.delete(ticket.id);}}
  finally{button.disabled=false;}
});

const management=installManagement({state,supervisor,editing,showView,notice,load,nameFor,jobFor,openTicket(t){if(!t)return;$('#ticket-search').value=t.ticket_no;$('#ticket-person-filter').value='';$('#ticket-job-filter').value='';$('#ticket-date-from').value='';$('#ticket-date-to').value='';$('#ticket-filter').value='all';$('#ticket-completeness').value='all';expandedTickets.add(t.id);renderTickets();showView('tickets');}});
boot();

document.addEventListener('click',e=>{const b=e.target.closest('[data-person-drill]');if(!b)return;$('#ticket-search').value='';$('#ticket-person-filter').value=b.dataset.personDrill;$('#ticket-job-filter').value=b.dataset.personJob||$('#dashboard-job').value;$('#ticket-date-basis').value=$('#dashboard-date-basis').value;$('#ticket-date-from').value=$('#dashboard-from').value;$('#ticket-date-to').value=$('#dashboard-to').value;$('#ticket-filter').value=b.dataset.personStatus;$('#ticket-completeness').value=b.dataset.personCompleteness;renderTickets();showView('tickets');});
