export function pickError(materials,picks,closeStatus=null) {
  if(!materials.length || picks.length!==materials.length) return 'กรุณายืนยันให้ครบทุกรายการ';
  let shortages=0;
  for(let i=0;i<materials.length;i++){
    const p=picks[i], required=Number(materials[i].required_qty),actual=p.actual_qty;
    if(typeof actual!=='number'||!Number.isFinite(actual)||actual<0||actual>required||Math.abs(actual*10000-Math.round(actual*10000))>0.001) return `รายการ ${i+1}: ใส่จำนวนตั้งแต่ 0 ถึง ${required} ทศนิยมไม่เกิน 4 ตำแหน่ง`;
    const reason=String(p.short_reason||'').trim();
    if(reason.length>1000) return `รายการ ${i+1}: เหตุผลยาวเกิน 1,000 ตัวอักษร`;
    if(actual<required){shortages++;if(!reason)return `รายการ ${i+1}: กรุณาระบุเหตุผลที่เบิกขาด`;}
  }
  if(closeStatus==='done'&&shortages) return 'มีรายการขาด กรุณาเลือกปิดเป็นเบิกไม่ครบ';
  if(closeStatus==='partial'&&!shortages) return 'ไม่มีรายการขาด กรุณาเลือกจบงาน';
  return '';
}
export function confirmedPickSummary(tickets){
  let confirmed=0,picked=0,short=0,unknown=0;
  for(const t of tickets) for(const l of t.materials||[]){
    if(!l.confirmed_at||typeof l.actual_qty!=='number'){unknown++;continue;}
    confirmed++;if(l.actual_qty>0)picked++;if(l.actual_qty<Number(l.required_qty))short++;
  }
  return {confirmed,picked,short,unknown};
}
