import {significantShortage,significantVariance} from './pick-tolerance.mjs?v=2';
export function pickError(materials,picks,closeStatus=null) {
  if(!materials.length || picks.length!==materials.length) return 'กรุณายืนยันให้ครบทุกรายการ';
  let shortages=0;
  for(let i=0;i<materials.length;i++){
    const p=picks[i], required=Number(materials[i].required_qty),actual=p.actual_qty;
    if(typeof actual!=='number'||!Number.isFinite(actual)||actual<0||actual>1000000000||Math.abs(actual*10000-Math.round(actual*10000))>0.001) return `รายการ ${i+1}: ใส่จำนวนตั้งแต่ 0 ถึง 1,000,000,000 ทศนิยมไม่เกิน 4 ตำแหน่ง`;
    const reason=String(p.short_reason||'').trim();
    if(reason.length>1000) return `รายการ ${i+1}: เหตุผลยาวเกิน 1,000 ตัวอักษร`;
    if(significantShortage(required,actual))shortages++;
    if(significantVariance(required,actual)&&!reason)return `รายการ ${i+1}: กรุณาระบุเหตุผลที่เบิกขาดหรือเกิน`;
  }
  if(closeStatus==='done'&&shortages) return 'มีรายการขาด กรุณาเลือกปิดเป็นเบิกไม่ครบ';
  if(closeStatus==='partial'&&!shortages) return 'ไม่มีรายการขาด กรุณาเลือกจบงาน';
  return '';
}
export function confirmedPickSummary(tickets){
  let confirmed=0,picked=0,short=0,over=0,unknown=0;
  for(const t of tickets) for(const l of t.materials||[]){
    if(!l.confirmed_at||typeof l.actual_qty!=='number'){unknown++;continue;}
    confirmed++;if(l.actual_qty>0)picked++;if(significantShortage(l.required_qty,l.actual_qty))short++;if(significantVariance(l.required_qty,l.actual_qty)&&l.actual_qty>Number(l.required_qty))over++;
  }
  return {confirmed,picked,short,over,unknown};
}

export function actualFromInput(required,value,mode='actual'){
 if(value==='')return null;const n=Number(value);if(!Number.isFinite(n)||n<0||Math.abs(n*10000-Math.round(n*10000))>0.001)return NaN;
 return Math.round((mode==='short'?Number(required)-n:mode==='over'?Number(required)+n:n)*10000)/10000;
}
export function pickVarianceText(required,actual,unit,format=String){
 const delta=Math.round((Number(actual)-Number(required))*10000)/10000;
 return delta===0?'ครบตามใบเบิก':Math.abs(delta)<=1?'เบิกครบ':(delta<0?'ขาด ':'เกิน ')+format(Math.abs(delta))+' '+unit;
}
export function convertPickMode(required,value,previous,next){
 if(value==='')return '';
 const actual=actualFromInput(required,value,previous);
 if(!Number.isFinite(actual)||actual<0)return '';
 const converted=Math.round((next==='short'?Number(required)-actual:next==='over'?actual-Number(required):actual)*10000)/10000;
 return converted<0?'':String(converted);
}

export function defaultPickActual(line){
 const actual=line.confirmed_at?line.actual_qty:line.required_qty;
 return actual!==null&&actual!==undefined&&Number.isFinite(Number(actual))?Number(actual):'';
}
export function automaticPickCloseStatus(materials,picks,requested){
 if(!requested)return null;
 return materials.some((line,i)=>typeof picks[i]?.actual_qty==='number'&&significantShortage(line.required_qty,picks[i].actual_qty))?'partial':'done';
}
