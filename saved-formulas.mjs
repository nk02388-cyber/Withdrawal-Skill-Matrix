import {isWipCode,pickingFormulas} from './material-policy.mjs';
const codePattern = /^[A-Z0-9/._-]{1,80}$/;
export function formulaDraft({fg_code,fg_name,base_qty,bomLines=[],stockLines=[]}) {
  const code=String(fg_code||'').trim().toUpperCase(),name=String(fg_name||'').trim(),qty=Number(base_qty);
  if(!codePattern.test(code))throw Error('ใส่รหัส FG ใช้ตัวอักษรอังกฤษ ตัวเลข - _ . หรือ /');
  if(!name||name.length>300)throw Error('ใส่ชื่อสูตรหรือสินค้า FG ไม่เกิน 300 ตัวอักษร');
  if(!Number.isFinite(qty)||qty<=0||qty>1000000||Math.abs(qty*1000-Math.round(qty*1000))>0.000001)throw Error('ใส่จำนวนผลิตฐาน 0.001–1,000,000 FG ไม่เกิน 3 ตำแหน่งทศนิยม');
  const lines=[...bomLines.map(line=>({...line,qty_per_unit:Number(line.qty_per_unit)})),...stockLines.map(line=>({...line,qty_per_unit:Number((Number(line.required_qty)/qty).toFixed(12))}))];
  if(!lines.length||lines.length>30)throw Error('สูตรต้องมีวัสดุ 1–30 รายการ');
  const seen=new Set();
  const normalized=lines.map(line=>{
    const pk_code=String(line.pk_code||'').trim().toUpperCase(),pk_name=String(line.pk_name||'').trim(),unit=String(line.unit||'').trim(),rate=Number(line.qty_per_unit);
    if(isWipCode(pk_code))throw Error(`รหัส ${pk_code} เป็น WIP ไม่ใช้ในใบเบิกบรรจุภัณฑ์`);
    if(!codePattern.test(pk_code)||!pk_name||pk_name.length>300||!unit||unit.length>30||!Number.isFinite(rate)||rate<=0||rate>1000000000)throw Error(`ข้อมูลวัสดุ ${pk_code||'ไม่ระบุรหัส'} ไม่ครบหรือจำนวนไม่ถูกต้อง`);
    if(seen.has(pk_code))throw Error(`วัสดุ ${pk_code} ซ้ำในสูตร`);
    seen.add(pk_code);
    return {pk_code,pk_name,unit,qty_per_unit:rate,source:'bom'};
  });
  return {fg_code:code,fg_name:name,base_qty:qty,lines:normalized};
}
export function mergeFormulas(pk=[],saved=[]) {
  const rows=new Map(pickingFormulas(pk).map(f=>[f.fg_code.toUpperCase(),{...f,origin:f.origin||'pk'}]));
  for(const f of pickingFormulas(saved))rows.set(f.fg_code.toUpperCase(),{...f,origin:'saved'});
  return [...rows.values()];
}
