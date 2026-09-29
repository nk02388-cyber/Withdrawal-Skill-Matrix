import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value) => value ? new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';
const state = { client:null, user:null, profile:null, people:[], jobs:[], tickets:[], skills:[], view:'dashboard', authMode:'login', timer:null };

function notice(message, error=false){ const el=$('#notice'); el.textContent=message; el.hidden=!message; el.style.background=error?'#ffece8':'#e2f6f1'; el.style.color=error?'#a74436':'#12685b'; }
function syncLabel(label, online=false){ $('#sync-label').textContent=label; $('.sync-dot').classList.toggle('online',online); }
function empty(message){return `<div class="empty">${esc(message)}</div>`;}
function isAdmin(){return state.profile?.role==='admin';}
function nameFor(id){return state.people.find(p=>p.id===id)?.display_name || (id===state.profile?.id?state.profile.display_name:'พนักงาน');}
function jobFor(id){return state.jobs.find(j=>j.id===id)?.name || 'ประเภทงานที่ปิดใช้งาน';}
function statusText(status){return {queued:'รอดำเนินการ',active:'กำลังทำ',done:'เสร็จแล้ว'}[status]||status;}

async function boot(){
  if(!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY){
    $('#auth-message').textContent='ยังไม่ได้ตั้งค่าฐานข้อมูลกลางใน config.js'; syncLabel('ยังไม่ตั้งค่าฐานข้อมูล'); return;
  }
  state.client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  state.client.auth.onAuthStateChange((_event,session)=>{ if(session?.user?.id!==state.user?.id){state.user=session?.user||null;setTimeout(initUser,0);} });
  const {data,error}=await state.client.auth.getUser();
  if(error && error.name!=='AuthSessionMissingError') $('#auth-message').textContent=error.message;
  state.user=data?.user||null; await initUser();
}
async function initUser(){
  if(!state.user){ state.profile=null; $('#auth-overlay').hidden=false; clearInterval(state.timer); syncLabel('รอเข้าสู่ระบบ'); return; }
  const {data,error}=await state.client.from('profiles').select('*').eq('id',state.user.id).single();
  if(error){$('#auth-overlay').hidden=false;$('#auth-message').textContent=`โหลดโปรไฟล์ไม่สำเร็จ: ${error.message}`;return;}
  state.profile=data;
  if(!data.active){$('#auth-overlay').hidden=false;$('#auth-message').textContent='สมัครแล้ว รอผู้ดูแลเปิดสิทธิ์ใช้งาน';syncLabel('รอเปิดสิทธิ์');return;}
  $('#auth-overlay').hidden=true;$('#auth-message').textContent='';$('#user-label').textContent=`${data.display_name} · ${isAdmin()?'ผู้ดูแล':'พนักงาน'}`;
  document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!isAdmin());
  if(!isAdmin() && ['people','settings'].includes(state.view)) state.view='dashboard';
  showView(state.view); await load(); clearInterval(state.timer); state.timer=setInterval(()=>{if(!document.hidden)load(true)},15000);
}
async function load(silent=false){
  if(!state.profile?.active)return;
  syncLabel('กำลังซิงก์…');
  const results=await Promise.all([
    state.client.from('profiles').select('id,email,display_name,role,active').order('display_name'),
    state.client.from('job_types').select('*').order('name'),
    state.client.from('tickets').select('*').order('created_at',{ascending:false}),
    state.client.from('skill_ratings').select('*')
  ]);
  const error=results.find(r=>r.error)?.error;
  if(error){syncLabel('ซิงก์ไม่สำเร็จ');if(!silent)notice(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`,true);return;}
  [state.people,state.jobs,state.tickets,state.skills]=results.map(r=>r.data||[]);
  syncLabel(`ซิงก์ล่าสุด ${new Intl.DateTimeFormat('th-TH',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`,true);
  render();
}
function showView(view){
  state.view=view;
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`${view}-view`);
  document.querySelectorAll('#nav button').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  $('#page-title').textContent={dashboard:'ภาพรวมและ Skill Matrix',tickets:'งานเบิกของ',people:'พนักงาน',settings:'ประเภทงานและทักษะ'}[view];
}
function render(){ renderDashboard(); renderTickets(); if(isAdmin()){renderPeople();renderSettings();} }
function renderDashboard(){
  const tickets=state.tickets;
  const metrics=[['ใบเบิกทั้งหมด',tickets.length],['รอดำเนินการ',tickets.filter(t=>t.status==='queued').length],['กำลังทำ',tickets.filter(t=>t.status==='active').length],['เสร็จแล้ว',tickets.filter(t=>t.status==='done').length]];
  $('#metrics').innerHTML=metrics.map(([label,value])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('');
  const people=state.people.filter(p=>p.active && p.role==='worker');
  const jobs=state.jobs.filter(j=>j.active);
  $('#matrix').innerHTML=!people.length||!jobs.length ? empty(isAdmin()?'เพิ่มประเภทงานและเปิดสิทธิ์พนักงานเพื่อเริ่ม Skill Matrix':'ยังไม่มีประเภทงานหรือการประเมินทักษะ') : `<table class="matrix"><thead><tr><th>พนักงาน</th>${jobs.map(j=>`<th>${esc(j.name)}</th>`).join('')}</tr></thead><tbody>${people.map(p=>`<tr><td><span class="person-name">${esc(p.display_name)}</span><span class="person-email">${esc(p.email)}</span></td>${jobs.map(j=>{const level=state.skills.find(s=>s.profile_id===p.id&&s.job_type_id===j.id)?.level||0;const count=tickets.filter(t=>t.assignee_id===p.id&&t.job_type_id===j.id&&t.status==='done').length;return `<td><span class="skill-cell"><span class="skill-badge level-${level}">${level}</span><span class="done-count">${count} งาน</span></span></td>`}).join('')}</tr>`).join('')}</tbody></table>`;
  const active=tickets.filter(t=>t.status==='active').slice(0,5);
  $('#active-list').innerHTML=active.length?active.map(ticketHtml).join(''):empty('ยังไม่มีงานที่กำลังทำ');
}
function ticketHtml(t){
  const action=t.status==='queued' && (isAdmin()||t.assignee_id===state.user.id) ? `<button class="primary" data-action="start" data-id="${esc(t.id)}">เริ่มงาน</button>` : t.status==='active' && (isAdmin()||t.assignee_id===state.user.id) ? `<button class="primary" data-action="finish" data-id="${esc(t.id)}">จบงาน</button>` : '';
  let duration='';if(t.started_at&&t.ended_at){const mins=Math.max(0,Math.round((new Date(t.ended_at)-new Date(t.started_at))/60000));duration=` · ${Math.floor(mins/60)} ชม. ${mins%60} นาที`;}
  return `<article class="ticket"><div class="ticket-main"><div class="ticket-code">${esc(t.ticket_no)}</div><h4>${esc(jobFor(t.job_type_id))}</h4><div class="ticket-meta">${esc(nameFor(t.assignee_id))} · สร้าง ${fmt(t.created_at)}</div>${t.description?`<p class="ticket-detail">${esc(t.description)}</p>`:''}</div><div class="ticket-right"><span class="status ${esc(t.status)}">${statusText(t.status)}</span><div class="ticket-time">เริ่ม ${fmt(t.started_at)}<br>จบ ${fmt(t.ended_at)}${duration}</div>${action}</div></article>`;
}
function renderTickets(){const filter=$('#ticket-filter').value;const list=state.tickets.filter(t=>filter==='all'||t.status===filter);$('#ticket-count').textContent=`${list.length} รายการ`;$('#ticket-list').innerHTML=list.length?list.map(ticketHtml).join(''):empty('ยังไม่มีใบเบิกในสถานะนี้');}
function renderPeople(){
  $('#people-list').innerHTML=state.people.length?state.people.map(p=>`<div class="person-row"><div><strong>${esc(p.display_name)}</strong><small>${esc(p.email)}</small></div><div class="person-controls"><span class="pill ${p.role==='admin'?'admin':''}">${p.role==='admin'?'ผู้ดูแล':'พนักงาน'}</span><label class="hint"><input type="checkbox" data-active="${esc(p.id)}" ${p.active?'checked':''} ${p.id===state.user.id?'disabled':''}> เปิดสิทธิ์</label></div></div>`).join(''):empty('ยังไม่มีพนักงานสมัครบัญชี');
}
function renderSettings(){
  $('#job-list').innerHTML=state.jobs.length?state.jobs.map(j=>`<div class="job-row"><strong>${esc(j.name)}</strong><label class="hint"><input type="checkbox" data-job-active="${esc(j.id)}" ${j.active?'checked':''}> เปิดใช้งาน</label></div>`).join(''):empty('ยังไม่มีประเภทงาน');
  const people=state.people.filter(p=>p.active&&p.role==='worker');const jobs=state.jobs.filter(j=>j.active);
  $('#skill-editor').innerHTML=!people.length||!jobs.length?empty('เพิ่มประเภทงานและเปิดสิทธิ์พนักงานก่อนกำหนดทักษะ'):`<div class="matrix-wrap"><table class="skill-edit-table"><thead><tr><th>พนักงาน</th><th>Job</th><th>ระดับทักษะ</th></tr></thead><tbody>${people.flatMap(p=>jobs.map(j=>{const level=state.skills.find(s=>s.profile_id===p.id&&s.job_type_id===j.id)?.level||0;return `<tr><td>${esc(p.display_name)}</td><td>${esc(j.name)}</td><td><select data-skill="${esc(p.id)}" data-job="${esc(j.id)}">${['ยังไม่ประเมิน','1 · เริ่มต้น','2 · ทำได้','3 · ชำนาญ','4 · สอนงานได้'].map((label,i)=>`<option value="${i}" ${i===level?'selected':''}>${label}</option>`).join('')}</select></td></tr>`})).join('')}</tbody></table></div>`;
}

document.addEventListener('click',async e=>{
  const nav=e.target.closest('#nav button[data-view]');if(nav){showView(nav.dataset.view);return;}
  const action=e.target.closest('button[data-action]');if(action){action.disabled=true;const fn=action.dataset.action==='start'?'start_ticket':'finish_ticket';const {error}=await state.client.rpc(fn,{p_ticket_id:action.dataset.id});if(error)notice(`บันทึกเวลาไม่สำเร็จ: ${error.message}`,true);else{notice(fn==='start_ticket'?'เริ่มงานแล้ว':'จบงานแล้ว');await load(true);}action.disabled=false;}
  if(e.target.closest('[data-close]'))$('#ticket-dialog').close();
});
$('#auth-toggle').addEventListener('click',()=>{state.authMode=state.authMode==='login'?'signup':'login';$('#auth-submit').textContent=state.authMode==='login'?'เข้าสู่ระบบ':'สมัครบัญชี';$('#auth-toggle').textContent=state.authMode==='login'?'ยังไม่มีบัญชี? สมัครใช้งาน':'มีบัญชีแล้ว? เข้าสู่ระบบ';$('#auth-message').textContent='';});
$('#auth-form').addEventListener('submit',async e=>{e.preventDefault();if(!state.client)return;const form=new FormData(e.target);const email=String(form.get('email')).trim(),password=String(form.get('password'));const btn=$('#auth-submit');btn.disabled=true;const {error}=state.authMode==='login'?await state.client.auth.signInWithPassword({email,password}):await state.client.auth.signUp({email,password});btn.disabled=false;$('#auth-message').textContent=error?error.message:state.authMode==='signup'?'สมัครแล้ว ตรวจอีเมลยืนยันบัญชี จากนั้นรอผู้ดูแลเปิดสิทธิ์':'กำลังเข้าสู่ระบบ…';if(!error&&state.authMode==='login'){const {data}=await state.client.auth.getUser();state.user=data.user;await initUser();}});
$('#logout-btn').addEventListener('click',async()=>{await state.client.auth.signOut();state.user=null;await initUser();});
$('#refresh-btn').addEventListener('click',()=>load());
$('#ticket-filter').addEventListener('change',renderTickets);
$('#new-ticket-btn').addEventListener('click',()=>{const jobs=state.jobs.filter(j=>j.active),people=state.people.filter(p=>p.active&&p.role==='worker');if(!jobs.length||!people.length){notice('ต้องมีประเภทงานและพนักงานที่เปิดสิทธิ์ก่อนสร้างใบเบิก',true);return;}$('#ticket-form [name="job_type_id"]').innerHTML=jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');$('#ticket-form [name="assignee_id"]').innerHTML=people.map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('');$('#ticket-dialog').showModal();});
$('#ticket-form').addEventListener('submit',async e=>{e.preventDefault();const form=new FormData(e.target);const payload={ticket_no:String(form.get('ticket_no')).trim(),job_type_id:form.get('job_type_id'),assignee_id:form.get('assignee_id'),description:String(form.get('description')).trim(),created_by:state.user.id};const {error}=await state.client.from('tickets').insert(payload);if(error){notice(`สร้างใบเบิกไม่สำเร็จ: ${error.message}`,true);return;}e.target.reset();$('#ticket-dialog').close();notice('บันทึกใบเบิกแล้ว');await load(true);});
$('#job-form').addEventListener('submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')).trim();if(!name)return;const {error}=await state.client.from('job_types').insert({name});if(error){notice(`เพิ่มประเภทงานไม่สำเร็จ: ${error.message}`,true);return;}e.target.reset();notice('เพิ่มประเภทงานแล้ว');await load(true);});
document.addEventListener('change',async e=>{let query;if(e.target.matches('[data-active]')){query=state.client.from('profiles').update({active:e.target.checked}).eq('id',e.target.dataset.active);}else if(e.target.matches('[data-job-active]')){query=state.client.from('job_types').update({active:e.target.checked}).eq('id',e.target.dataset.jobActive);}else if(e.target.matches('[data-skill]')){query=state.client.from('skill_ratings').upsert({profile_id:e.target.dataset.skill,job_type_id:e.target.dataset.job,level:Number(e.target.value)},{onConflict:'profile_id,job_type_id'});}else return;const {error}=await query;if(error)notice(`บันทึกไม่สำเร็จ: ${error.message}`,true);else notice('บันทึกแล้ว');await load(true);});
boot();
