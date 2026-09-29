import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { filterTickets } from './ticket-report.mjs';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = v => v ? new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)) : '—';
const fmtReport = v => v ? new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(v)) : '—';
const state = {db:null,code:sessionStorage.getItem('editCode')||'',people:[],jobs:[],tickets:[],skills:[],bom:null,view:'dashboard'};
const editing = () => !!state.code;
const empty = msg => `<div class="empty">${esc(msg)}</div>`;
const nameFor = id => state.people.find(p=>p.id===id)?.display_name||'ไม่พบพนักงาน';
const jobFor = id => state.jobs.find(j=>j.id===id)?.name||'ไม่พบประเภทงาน';
const qtyText = value => new Intl.NumberFormat('th-TH',{maximumFractionDigits:4}).format(Number(value));
const calcQty = (rate, qty) => Math.round((Number(rate)*qty+Number.EPSILON)*10000)/10000;
const chosenFormula = () => state.bom?.formulas.find(f=>f.fg_code===$('#bom-select').value);
function materialTable(lines){return `<div class="bom-table-wrap"><table class="bom-table"><thead><tr><th>รหัส PK / วัตถุดิบ</th><th>อัตราต่อ 1 FG</th><th>จำนวนเบิกตามสูตร</th></tr></thead><tbody>${lines.map(l=>`<tr><td><strong>${esc(l.pk_code)}</strong><small>${esc(l.pk_name)}</small></td><td>${qtyText(l.qty_per_unit)} ${esc(l.unit)}</td><td><strong>${qtyText(l.required_qty)} ${esc(l.unit)}</strong></td></tr>`).join('')}</tbody></table></div>`;}
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
  const f=chosenFormula(),qty=Number($('#ticket-form [name="requested_qty"]').value);
  if(!f){$('#bom-preview').innerHTML=empty('เลือกสูตรการผลิตเพื่อดูรายการวัตถุดิบ');return;}
  if(!Number.isFinite(qty)||qty<=0){$('#bom-preview').innerHTML=empty('ใส่จำนวนที่ต้องการผลิตเพื่อคำนวณวัสดุ');return;}
  if(f.lines.some(l=>!Number.isFinite(Number(l.qty_per_unit))||Number(l.qty_per_unit)<=0)){$('#bom-preview').innerHTML=empty('สูตรนี้มีอัตราใช้วัสดุไม่ครบ กรุณาตรวจสูตรใน PK WMS ก่อนสร้างใบเบิก');return;}
  const lines=f.lines.map(l=>({...l,required_qty:calcQty(l.qty_per_unit,qty)}));
  $('#bom-preview').innerHTML=`<div class="bom-summary"><strong>${esc(f.fg_code)} · ${esc(f.fg_name)}</strong><span>จำนวน ${qtyText(qty)} FG · ${lines.length} รายการวัสดุ</span></div>${materialTable(lines)}<p class="hint">จำนวนเบิกคำนวณตาม BOM (4 ตำแหน่ง) กรุณาตรวจสอบหน่วยและจำนวนจริงก่อนเบิก</p>`;
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
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!editing());
  $('#user-label').textContent=editing()?'โหมดแก้ไข':'โหมดดูข้อมูล';
  $('#edit-btn').textContent=editing()?'ปิดโหมดแก้ไข':'ใส่รหัสแก้ข้อมูล';
  if(!editing()&&['people','settings'].includes(state.view))showView('dashboard');
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
function render(){renderDashboard();renderTickets();if(editing()){renderPeople();renderSettings();}}
function renderDashboard(){
  const t=state.tickets;
  $('#metrics').innerHTML=[['ใบเบิกทั้งหมด',t.length],['รอดำเนินการ',t.filter(x=>x.status==='queued').length],['กำลังทำ',t.filter(x=>x.status==='active').length],['เสร็จแล้ว',t.filter(x=>x.status==='done').length]].map(([label,value])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('');
  const people=state.people.filter(p=>p.active),jobs=state.jobs.filter(j=>j.active);
  $('#matrix').innerHTML=!people.length||!jobs.length?empty('ยังไม่มีพนักงานหรือประเภทงาน เปิดโหมดแก้ไขเพื่อเริ่มบันทึก'):`<table class="matrix"><thead><tr><th>พนักงาน</th>${jobs.map(j=>`<th>${esc(j.name)}</th>`).join('')}</tr></thead><tbody>${people.map(p=>`<tr><td><span class="person-name">${esc(p.display_name)}</span></td>${jobs.map(j=>{const level=state.skills.find(s=>s.profile_id===p.id&&s.job_type_id===j.id)?.level||0;const count=t.filter(x=>x.assignee_id===p.id&&x.job_type_id===j.id&&x.status==='done').length;return `<td><span class="skill-cell"><span class="skill-badge level-${level}">${level}</span><span class="done-count">${count} งาน</span></span></td>`}).join('')}</tr>`).join('')}</tbody></table>`;
  const active=t.filter(x=>x.status==='active').slice(0,5);$('#active-list').innerHTML=active.length?active.map(ticketHtml).join(''):empty('ยังไม่มีงานที่กำลังทำ');
}
function ticketHtml(t){
  const status={queued:'รอดำเนินการ',active:'กำลังทำ',done:'เสร็จแล้ว'}[t.status]||t.status;
  const action=editing()&&t.status==='queued'?`<button class="primary" data-action="start" data-id="${esc(t.id)}">เริ่มงาน</button>`:editing()&&t.status==='active'?`<button class="primary" data-action="finish" data-id="${esc(t.id)}">จบงาน</button>`:'';
  let duration='';if(t.started_at&&t.ended_at){const mins=Math.max(0,Math.round((new Date(t.ended_at)-new Date(t.started_at))/60000));duration=` · ${Math.floor(mins/60)} ชม. ${mins%60} นาที`;}
  const bom=t.fg_code?`<div class="ticket-fg"><strong>${esc(t.fg_code)} · ${esc(t.fg_name)}</strong><span>จำนวน ${qtyText(t.requested_qty)} FG</span></div>${Array.isArray(t.materials)&&t.materials.length?`<details class="ticket-materials"><summary>ดูวัตถุดิบตาม BOM ${t.materials.length} รายการ</summary>${materialTable(t.materials)}</details>`:''}`:'';
  return `<article class="ticket"><div class="ticket-main"><div class="ticket-code">${esc(t.ticket_no)}</div><h4>${esc(jobFor(t.job_type_id))}</h4><div class="ticket-meta">${esc(nameFor(t.assignee_id))} · สร้าง ${fmt(t.created_at)}</div>${bom}${t.description?`<p class="ticket-detail">${esc(t.description)}</p>`:''}</div><div class="ticket-right"><span class="status ${esc(t.status)}">${status}</span><div class="ticket-time">เริ่ม ${fmt(t.started_at)}<br>จบ ${fmt(t.ended_at)}${duration}</div>${action}</div></article>`;
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
  if(filters.status)parts.push(`สถานะ: ${{queued:'รอดำเนินการ',active:'กำลังทำ',done:'เสร็จแล้ว'}[filters.status]}`);
  return parts.length?parts.join(' · '):'ทุกใบเบิก';
}
function populateReport(list,filters){
  const counts={queued:0,active:0,done:0};list.forEach(ticket=>{if(ticket.status in counts)counts[ticket.status]++;});
  const rows=list.map((ticket,index)=>{
    const materials=Array.isArray(ticket.materials)&&ticket.materials.length?`<strong>วัสดุตาม BOM</strong><div>${ticket.materials.map(line=>`<span>${esc(line.pk_code)} ${esc(line.pk_name)}: ${qtyText(line.required_qty)} ${esc(line.unit)}</span>`).join('')}</div>`:'';
    const detail=materials||ticket.description?`<tr class="report-materials"><td colspan="9">${materials}${ticket.description?`<p><strong>หมายเหตุ:</strong> ${esc(ticket.description)}</p>`:''}</td></tr>`:'';
    const status={queued:'รอดำเนินการ',active:'กำลังทำ',done:'เสร็จแล้ว'}[ticket.status]||ticket.status;
    return `<tbody class="report-ticket"><tr><td>${index+1}</td><td><strong>${esc(ticket.ticket_no)}</strong></td><td>${esc(fmtReport(ticket.created_at))}</td><td>${esc(nameFor(ticket.assignee_id))}</td><td>${esc(jobFor(ticket.job_type_id))}</td><td>${ticket.fg_code?`${esc(ticket.fg_code)}<br>${esc(ticket.fg_name||'')}<br><strong>${qtyText(ticket.requested_qty)} FG</strong>`:'—'}</td><td>${esc(status)}</td><td>${esc(fmtReport(ticket.started_at))}</td><td>${esc(fmtReport(ticket.ended_at))}</td></tr>${detail}</tbody>`;
  }).join('');
  $('#print-report').innerHTML=`<header><img src="assets/pk-no1-logo.png" alt="PK No.1"><div><h1>รายงานงานเบิกของ</h1><p>พิมพ์เมื่อ ${esc(fmtReport(new Date()))} · เวลาไทย (UTC+7)</p></div></header><div class="report-filter-line"><strong>ตัวกรอง:</strong> ${esc(reportFiltersText(filters))}</div><div class="report-summary"><span>ทั้งหมด <strong>${list.length}</strong></span><span>รอดำเนินการ <strong>${counts.queued}</strong></span><span>กำลังทำ <strong>${counts.active}</strong></span><span>เสร็จแล้ว <strong>${counts.done}</strong></span></div><table class="report-table"><thead><tr><th>#</th><th>เลขที่ใบเบิก</th><th>วันที่สร้าง</th><th>พนักงาน</th><th>Job</th><th>FG / จำนวน</th><th>สถานะ</th><th>เริ่ม</th><th>สิ้นสุด</th></tr></thead>${rows||'<tbody><tr><td colspan="9">ไม่พบใบเบิกตามตัวกรอง</td></tr></tbody>'}</table><p class="report-note">จำนวนวัสดุคำนวณตาม BOM ที่บันทึกกับใบเบิก ไม่ใช่หลักฐานการตัดสต็อก</p>`;
}
function printReport(){const list=selectedTickets();populateReport(list,ticketFilters());document.body.classList.add('print-tickets');window.print();}
function renderPeople(){$('#people-list').innerHTML=state.people.length?state.people.map(p=>`<div class="person-row"><strong>${esc(p.display_name)}</strong><div class="person-controls"><label class="hint"><input type="checkbox" data-active="${esc(p.id)}" ${p.active?'checked':''}> เปิดใช้งาน</label></div></div>`).join(''):empty('ยังไม่มีพนักงาน');}
function renderSettings(){const people=state.people.filter(p=>p.active),jobs=state.jobs.filter(j=>j.active);$('#job-list').innerHTML=state.jobs.length?state.jobs.map(j=>`<div class="job-row"><strong>${esc(j.name)}</strong><label class="hint"><input type="checkbox" data-job-active="${esc(j.id)}" ${j.active?'checked':''}> เปิดใช้งาน</label></div>`).join(''):empty('ยังไม่มีประเภทงาน');$('#skill-editor').innerHTML=!people.length||!jobs.length?empty('เพิ่มพนักงานและประเภทงานก่อนกำหนดทักษะ'):`<div class="matrix-wrap"><table class="skill-edit-table"><thead><tr><th>พนักงาน</th><th>Job</th><th>ระดับทักษะ</th></tr></thead><tbody>${people.flatMap(p=>jobs.map(j=>{const level=state.skills.find(s=>s.profile_id===p.id&&s.job_type_id===j.id)?.level||0;return `<tr><td>${esc(p.display_name)}</td><td>${esc(j.name)}</td><td><select data-skill="${esc(p.id)}" data-job="${esc(j.id)}">${['ยังไม่ประเมิน','1 · เริ่มต้น','2 · ทำได้','3 · ชำนาญ','4 · สอนงานได้'].map((label,i)=>`<option value="${i}" ${i===level?'selected':''}>${label}</option>`).join('')}</select></td></tr>`})).join('')}</tbody></table></div>`;}
async function mutate(fn,args,success){const {error}=await state.db.rpc(fn,{p_code:state.code,...args});if(error){notice(`บันทึกไม่สำเร็จ: ${error.message}`,true);return false;}notice(success);await load(true);return true;}

document.addEventListener('click',async e=>{
  const nav=e.target.closest('#nav button[data-view]');if(nav){showView(nav.dataset.view);return;}
  const action=e.target.closest('button[data-action]');if(action){action.disabled=true;await mutate(action.dataset.action==='start'?'start_ticket_with_code':'finish_ticket_with_code',{p_ticket_id:action.dataset.id},action.dataset.action==='start'?'เริ่มงานแล้ว':'จบงานแล้ว');action.disabled=false;}
  if(e.target.closest('[data-close]'))e.target.closest('dialog').close();
});
$('#edit-btn').addEventListener('click',()=>{if(editing()){state.code='';sessionStorage.removeItem('editCode');updateMode();notice('ปิดโหมดแก้ไขแล้ว');}else $('#code-dialog').showModal();});
$('#code-form').addEventListener('submit',async e=>{e.preventDefault();const code=String(new FormData(e.target).get('code')).trim();const {data,error}=await state.db.rpc('verify_edit_code',{p_code:code});if(error||!data){$('#code-message').textContent='รหัสไม่ถูกต้อง';return;}state.code=code;sessionStorage.setItem('editCode',code);e.target.reset();$('#code-message').textContent='';$('#code-dialog').close();updateMode();notice('เปิดโหมดแก้ไขแล้ว');});
$('#refresh-btn').addEventListener('click',()=>load());
['#ticket-search','#ticket-date-from','#ticket-date-to'].forEach(selector=>$(selector).addEventListener('input',renderTickets));
['#ticket-person-filter','#ticket-job-filter','#ticket-filter'].forEach(selector=>$(selector).addEventListener('change',renderTickets));
$('#clear-ticket-filters').addEventListener('click',()=>{['#ticket-search','#ticket-person-filter','#ticket-job-filter','#ticket-date-from','#ticket-date-to'].forEach(selector=>$(selector).value='');$('#ticket-filter').value='all';renderTickets();});
$('#print-report-btn').addEventListener('click',printReport);
window.addEventListener('beforeprint',()=>{if(document.body.classList.contains('print-tickets'))populateReport(selectedTickets(),ticketFilters());});
window.addEventListener('afterprint',()=>document.body.classList.remove('print-tickets'));
$('#new-ticket-btn').addEventListener('click',async()=>{const jobs=state.jobs.filter(j=>j.active),people=state.people.filter(p=>p.active);if(!jobs.length||!people.length){notice('ต้องมีประเภทงานและพนักงานก่อนสร้างใบเบิก',true);return;}state.bom=null;if(!await loadBom())return;$('#ticket-form [name="job_type_id"]').innerHTML=jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');$('#ticket-form [name="assignee_id"]').innerHTML=people.map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');$('#bom-search').value='';renderBomOptions();$('#ticket-dialog').showModal();});
$('#bom-search').addEventListener('input',renderBomOptions);
$('#bom-select').addEventListener('change',renderBomPreview);
$('#ticket-form [name="requested_qty"]').addEventListener('input',renderBomPreview);
$('#ticket-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),formula=chosenFormula(),qty=Number(f.get('requested_qty'));if(!formula||!Number.isFinite(qty)||qty<=0||qty>1000000||Math.round(qty*1000)!==qty*1000){notice('เลือกสูตรและใส่จำนวน FG ที่ถูกต้อง',true);return;}if(formula.lines.some(l=>!Number.isFinite(Number(l.qty_per_unit))||Number(l.qty_per_unit)<=0)){notice('สูตรนี้มีอัตราใช้วัสดุไม่ครบ',true);return;}const lines=formula.lines.map(l=>({...l,required_qty:calcQty(l.qty_per_unit,qty)}));if(await mutate('create_bom_ticket_with_code',{p_ticket_no:String(f.get('ticket_no')).trim(),p_job_type_id:f.get('job_type_id'),p_assignee_id:f.get('assignee_id'),p_description:String(f.get('description')).trim(),p_fg_code:formula.fg_code,p_fg_name:formula.fg_name,p_requested_qty:qty,p_bom_version:state.bom.source_sha256,p_materials:lines},'บันทึกใบเบิกพร้อมรายการ BOM แล้ว')){e.target.reset();$('#ticket-dialog').close();}});
$('#staff-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(name&&await mutate('add_staff',{p_name:name},'เพิ่มพนักงานแล้ว'))e.target.reset();});
$('#job-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(name&&await mutate('add_job',{p_name:name},'เพิ่มประเภทงานแล้ว'))e.target.reset();});
document.addEventListener('change',async e=>{let fn,args;if(e.target.matches('[data-active]')){fn='set_staff_active';args={p_staff_id:e.target.dataset.active,p_active:e.target.checked};}else if(e.target.matches('[data-job-active]')){fn='set_job_active';args={p_job_id:e.target.dataset.jobActive,p_active:e.target.checked};}else if(e.target.matches('[data-skill]')){fn='set_skill_rating';args={p_staff_id:e.target.dataset.skill,p_job_id:e.target.dataset.job,p_level:Number(e.target.value)};}else return;await mutate(fn,args,'บันทึกแล้ว');});

async function boot(){if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY){syncLabel('ยังไม่ตั้งค่าฐานข้อมูล');notice('ยังไม่ได้ตั้งค่าฐานข้อมูลกลาง',true);return;}state.db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});updateMode();await load();setInterval(()=>{if(!document.hidden)load(true)},15000);}
boot();
