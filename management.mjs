import {fractionalVariance} from './pick-tolerance.mjs';
export const defaultSettings={start:'08:00',end:'17:00',lunchStart:'12:00',lunchEnd:'13:00',holidays:[],exceptionOwnerName:'สองนคร กรียินดี'};
export function settingsError(s){
 const times=['start','end','lunchStart','lunchEnd'].map(k=>s[k]);
 if(times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))return 'กรอกเวลาให้ครบในรูปแบบ HH:mm';
 if(!(s.start<s.lunchStart&&s.lunchStart<s.lunchEnd&&s.lunchEnd<s.end))return 'เวลาต้องเรียง: เริ่มกะ → เริ่มพัก → สิ้นสุดพัก → สิ้นสุดกะ';
 if(!Array.isArray(s.holidays)||s.holidays.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d))return 'วันหยุดต้องเป็นวันที่จริง รูปแบบ YYYY-MM-DD';
 return '';
}
export function varianceRows(tickets,cases=[]){return tickets.filter(t=>!t.deleted_at&&t.status!=='cancelled').flatMap(t=>(t.materials||[]).flatMap((l,i)=>{
 if(!l.confirmed_at||!Number.isFinite(l.actual_qty)||!Number.isFinite(Number(l.required_qty)))return [];
 const delta=Math.round((l.actual_qty-Number(l.required_qty))*10000)/10000;if(!delta)return [];
 const fingerprint=JSON.stringify([l.pk_code,Number(l.required_qty),l.actual_qty,l.confirmed_at]);
 const saved=cases.find(c=>c.ticket_id===t.id&&c.line_index===i);
 return [{ticket:t,line:l,index:i,delta,fingerprint,case:saved,fractional:fractionalVariance(l.required_qty,l.actual_qty),status:fractionalVariance(l.required_qty,l.actual_qty)?'resolved':saved?.fingerprint===fingerprint?saved.status:'open',stale:!!saved&&saved.fingerprint!==fingerprint}];
 }));}
export function matchesText(values,query){const words=String(query).trim().toLocaleLowerCase('th').split(/\s+/).filter(Boolean),hay=values.join(' ').toLocaleLowerCase('th');return words.every(w=>hay.includes(w));}
export function safeCsv(rows){return '\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');}
export function planOrder(tickets){const rank={urgent:0,high:1,normal:2};return [...tickets].sort((a,b)=>(rank[a.priority||'normal']-rank[b.priority||'normal'])||String(a.due_at||'9999').localeCompare(String(b.due_at||'9999'))||String(a.created_at).localeCompare(String(b.created_at)));}

export function followupComplete(ticket,cases=[]){
 if(ticket.deleted_at||!['done','partial'].includes(ticket.status))return false;
 const lines=ticket.materials||[];
 if(!lines.length||lines.some(l=>!l.confirmed_at||!Number.isFinite(l.actual_qty)||!Number.isFinite(Number(l.required_qty))))return false;
 const rows=varianceRows([ticket],cases);
 return rows.length>0&&rows.every(r=>r.status==='resolved');
}
