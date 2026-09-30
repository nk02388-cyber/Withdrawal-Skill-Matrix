const MINUTE=60000,DAY=86400000,OFFSET=7*3600000;
export const reasonLabels={stock_shortage:'สต็อกไม่พอ',approved_extra:'เบิกเผื่อที่ได้รับอนุมัติ',bom_difference:'สูตรหรือใบเบิกคลาดเคลื่อน',picking_error:'หยิบผิด',other:'อื่น ๆ'};
const dateMs=value=>value?Date.parse(value):NaN;
function merged(ranges){
  const sorted=ranges.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]),out=[];
  for(const r of sorted){const last=out.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else out.push([...r]);}return out;
}
export function workBreakdown(ticket,now=Date.now()){
  const start=dateMs(ticket.started_at),end=ticket.ended_at?dateMs(ticket.ended_at):now;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
  const pauses=merged((ticket.pause_intervals||[]).map(p=>[Math.max(start,dateMs(p.start)),Math.min(end,p.end?dateMs(p.end):end)]));
  let shift=0,waiting=0;
  for(let day=Math.floor((start+OFFSET)/DAY)*DAY-OFFSET;day<=end;day+=DAY){
    for(const [from,to] of [[8,12],[13,17]]){
      const a=Math.max(start,day+from*3600000),b=Math.min(end,day+to*3600000);
      if(b<=a)continue;shift+=b-a;
      for(const [p,q] of pauses)waiting+=Math.max(0,Math.min(b,q)-Math.max(a,p));
    }
  }
  return {activeMinutes:(shift-waiting)/MINUTE,waitingMinutes:waiting/MINUTE,totalMinutes:(end-start)/MINUTE,outsideMinutes:(end-start-shift)/MINUTE};
}
export function minutesText(minutes){if(minutes===null||!Number.isFinite(minutes))return '—';if(minutes>0&&minutes<1)return '<1 นาที';const n=Math.round(minutes);return `${Math.floor(n/60)} ชม. ${n%60} นาที`;}
export function pickCompleteness(ticket){
  const lines=Array.isArray(ticket.materials)?ticket.materials:[];
  const confirmed=lines.filter(l=>l.confirmed_at&&Number.isFinite(l.actual_qty));
  return {total:lines.length,confirmed:confirmed.length,complete:lines.length>0&&confirmed.length===lines.length,label:!lines.length?'งานไม่มีรายการวัสดุ':confirmed.length===lines.length?'บันทึกเบิกจริงครบ':`ข้อมูลเบิกจริงไม่ครบ ${confirmed.length}/${lines.length} รายการ`};
}
export function expectedMinutes(ticket,standards){
  const standard=standards.find(s=>s.job_type_id===ticket.job_type_id&&s.fg_code===(ticket.fg_code||''));
  if(!standard)return null;
  return Number(standard.setup_minutes)+Number(standard.minutes_per_line)*(ticket.materials?.length||0)+Number(standard.minutes_per_1000_fg)*Number(ticket.requested_qty||0)/1000;
}
export function operationalPerformance(tickets,standards){
  let expected=0,actual=0,matched=0,complete=0,pickingErrors=0,reviewNeeded=0;
  const comparisons=[];
  for(const ticket of tickets){
    if(!['done','partial'].includes(ticket.status))continue;
    const info=pickCompleteness(ticket);
    if(!info.complete)continue;complete++;
    for(const line of ticket.materials||[]){if(line.actual_qty===Number(line.required_qty))continue;if(line.reason_code==='picking_error')pickingErrors++;if(!line.reason_code||line.reason_code==='other')reviewNeeded++;}
    const duration=workBreakdown(ticket),target=expectedMinutes(ticket,standards);
    if(ticket.status==='done'&&duration?.activeMinutes>0&&target>0){expected+=target;actual+=duration.activeMinutes;matched++;comparisons.push({ticket_no:ticket.ticket_no,target,actual:duration.activeMinutes});}
  }
  return {complete,pickingErrors,reviewNeeded,matched,efficiency:matched?Math.round(expected/actual*100):null,comparisons};
}
export function documentRows(ticket){
  return Array.isArray(ticket.documents)?ticket.documents:[];
}
export function documentsError(rows,total,hasFg=true){
  if(!rows.length)return 'กรุณาระบุเลขที่ใบเบิก';
  const names=rows.map(r=>String(r.number||'').trim().toUpperCase());
  if(names.some(n=>!n)||new Set(names).size!==names.length)return 'เลขที่ใบเบิกว่างหรือซ้ำกัน';
  if(!hasFg)return '';
  if(rows.some(r=>typeof r.quantity!=='number'||!Number.isFinite(r.quantity)||r.quantity<=0||r.quantity>1000000||Math.abs(r.quantity*1000-Math.round(r.quantity*1000))>0.001))return 'กรอกจำนวนผลิตแต่ละใบให้ครบ ทศนิยมไม่เกิน 3 ตำแหน่ง';
  return Math.abs(rows.reduce((sum,r)=>sum+r.quantity,0)-Number(total))>.00001?'จำนวนผลิตรวมไม่ตรงกับยอดแต่ละใบ':'';
}
