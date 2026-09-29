import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = v => v ? new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)) : '—';
const state = {db:null,code:sessionStorage.getItem('editCode')||'',people:[],jobs:[],tickets:[],skills:[],view:'dashboard'};
const editing = () => !!state.code;
const empty = msg => `<div class="empty">${esc(msg)}</div>`;
const nameFor = id => state.people.find(p=>p.id===id)?.display_name||'ไม่พบพนักงาน';
const jobFor = id => state.jobs.find(j=>j.id===id)?.name||'ไม่พบประเภทงาน';

function notice(msg,error=false){const el=$('#notice');el.textContent=msg;el.hidden=!msg;el.style.background=error?'#ffece8':'#e2f6f1';el.style.color=error?'#a74436':'#12685b';}
function syncLabel(msg,ok=false){$('#sync-label').textContent=msg;$('.sync-dot').classList.toggle('online',ok);}
function updateMode(){
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!editing());
  $('#user-label').textContent=editing()?'โหมดแก้ไข':'โหมดดูข้อมูล';
  $('#edit-btn').textContent=editing()?'ปิดโหมดแก้ไข':'ใส่รหัสแก้ข้อมูล';
  if(!editing()&&['people','settings'].includes(state.view))showView('dashboard');
  render();
}
function showView(view){state.view=view;document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`${view}-view`);document.querySelectorAll('#nav button').forEach(el=>el.classList.toggle('active',el.dataset.view===view));$('#page-title').textContent={dashboard:'ภาพรวมและ Skill Matrix',tickets:'งานเบิกของ',people:'พนักงาน',settings:'ประเภทงานและทักษะ'}[view];}
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
  return `<article class="ticket"><div class="ticket-main"><div class="ticket-code">${esc(t.ticket_no)}</div><h4>${esc(jobFor(t.job_type_id))}</h4><div class="ticket-meta">${esc(nameFor(t.assignee_id))} · สร้าง ${fmt(t.created_at)}</div>${t.description?`<p class="ticket-detail">${esc(t.description)}</p>`:''}</div><div class="ticket-right"><span class="status ${esc(t.status)}">${status}</span><div class="ticket-time">เริ่ม ${fmt(t.started_at)}<br>จบ ${fmt(t.ended_at)}${duration}</div>${action}</div></article>`;
}
function renderTickets(){const filter=$('#ticket-filter').value;const list=state.tickets.filter(t=>filter==='all'||t.status===filter);$('#ticket-count').textContent=`${list.length} รายการ`;$('#ticket-list').innerHTML=list.length?list.map(ticketHtml).join(''):empty('ยังไม่มีใบเบิกในสถานะนี้');}
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
$('#refresh-btn').addEventListener('click',()=>load());$('#ticket-filter').addEventListener('change',renderTickets);
$('#new-ticket-btn').addEventListener('click',()=>{const jobs=state.jobs.filter(j=>j.active),people=state.people.filter(p=>p.active);if(!jobs.length||!people.length){notice('ต้องมีประเภทงานและพนักงานก่อนสร้างใบเบิก',true);return;}$('#ticket-form [name="job_type_id"]').innerHTML=jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');$('#ticket-form [name="assignee_id"]').innerHTML=people.map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');$('#ticket-dialog').showModal();});
$('#ticket-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);if(await mutate('create_ticket_with_code',{p_ticket_no:String(f.get('ticket_no')).trim(),p_job_type_id:f.get('job_type_id'),p_assignee_id:f.get('assignee_id'),p_description:String(f.get('description')).trim()},'บันทึกใบเบิกแล้ว')){e.target.reset();$('#ticket-dialog').close();}});
$('#staff-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(name&&await mutate('add_staff',{p_name:name},'เพิ่มพนักงานแล้ว'))e.target.reset();});
$('#job-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(name&&await mutate('add_job',{p_name:name},'เพิ่มประเภทงานแล้ว'))e.target.reset();});
document.addEventListener('change',async e=>{let fn,args;if(e.target.matches('[data-active]')){fn='set_staff_active';args={p_staff_id:e.target.dataset.active,p_active:e.target.checked};}else if(e.target.matches('[data-job-active]')){fn='set_job_active';args={p_job_id:e.target.dataset.jobActive,p_active:e.target.checked};}else if(e.target.matches('[data-skill]')){fn='set_skill_rating';args={p_staff_id:e.target.dataset.skill,p_job_id:e.target.dataset.job,p_level:Number(e.target.value)};}else return;await mutate(fn,args,'บันทึกแล้ว');});

async function boot(){if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY){syncLabel('ยังไม่ตั้งค่าฐานข้อมูล');notice('ยังไม่ได้ตั้งค่าฐานข้อมูลกลาง',true);return;}state.db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});updateMode();await load();setInterval(()=>{if(!document.hidden)load(true)},15000);}
boot();
