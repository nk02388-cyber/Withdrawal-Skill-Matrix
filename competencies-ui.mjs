const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installCompetencies({state,supervisor,mutate}){
 let catalog=[],ratings=[];
 document.querySelector('#dashboard-view').insertAdjacentHTML('beforeend','<section id="competency-overview" class="competency-panel"></section>');
 document.querySelector('#settings-view').insertAdjacentHTML('beforeend','<section id="competency-editor" class="competency-panel"></section>');
 function matrix(edit){
  const people=state.people.filter(p=>p.active);
  let category='';
  const rows=catalog.map(c=>{
   const group=c.category!==category?`<tr class="competency-group"><th colspan="${people.length+3}">${esc(c.category)}</th></tr>`:'';category=c.category;
   return group+`<tr><th scope="row">${esc(c.name)}</th><td class="competency-target">${c.target_foreman}</td><td class="competency-target">${c.target_admin}</td>${people.map(p=>{const level=ratings.find(r=>r.staff_id===p.id&&r.competency_id===c.id)?.level;return `<td>${edit?`<select data-competency="${c.id}" data-person="${p.id}" aria-label="${esc(p.display_name+' · '+c.name)}">${[0,1,2,3,4,5].map(v=>`<option value="${v}" ${v===(level??0)?'selected':''}>${v||'ยังไม่ประเมิน'}</option>`).join('')}</select>`:`<span class="competency-score ${level?'assessed':''}">${level??'—'}</span>`}</td>`;}).join('')}</tr>`;
  }).join('');
  return `<h3>Employee Skill Matrix · Warehouse packing</h3><p class="hint">20 ทักษะ · 3 หมวด · คะแนนประเมิน 1–5 โดยหัวหน้า · — = ยังไม่ประเมิน</p><p class="hint">เกณฑ์ PK Foreman / PK Admin = 5 ตามแบบฟอร์ม ไม่ใช่คะแนนรายคน · แยกจากระดับประสบการณ์งานเบิก 0–4 · แสดงคะแนนล่าสุด ไม่ใช้ตัวกรองวันที่ของใบเบิก</p><div class="competency-scroll"><table><thead><tr><th>ความรู้ / ทักษะ</th><th>เกณฑ์<br>PK Foreman</th><th>เกณฑ์<br>PK Admin</th>${people.map(p=>`<th>${esc(p.display_name)}<small>${esc(p.position||'ยังไม่ระบุตำแหน่ง')}</small></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
 }
 function render(){
  if(!catalog.length)return;
  document.querySelector('#competency-overview').innerHTML=matrix(false);
  if(supervisor()&&!document.querySelector('#competency-editor').contains(document.activeElement))document.querySelector('#competency-editor').innerHTML=matrix(true);
 }
 document.querySelector('#competency-editor').addEventListener('change',async e=>{
  const el=e.target;if(!el.matches('[data-competency]')||!supervisor())return;
  const old=ratings.find(r=>r.staff_id===el.dataset.person&&r.competency_id===el.dataset.competency)?.level??null;
  el.disabled=true;
  try{await mutate('set_competency_as_supervisor',{p_staff_id:el.dataset.person,p_competency_id:el.dataset.competency,p_level:Number(el.value),p_expected:old},'บันทึกคะแนนทักษะแล้ว');}finally{el.blur();render();}
 });
 return {render,async refresh(){const {data,error}=await state.db.rpc('get_competency_state');if(error)throw error;catalog=data.catalog||[];ratings=data.ratings||[];}};
}
