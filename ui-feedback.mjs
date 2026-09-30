export function saveErrorText(error){
  const message=String(error?.message||error||'');
  if(error?.code==='23505'||/duplicate key/i.test(message))return 'เลขที่ใบเบิกนี้มีอยู่แล้ว กรุณาใช้เลขที่อื่น';
  if(/changed|stale|conflict/i.test(message))return 'ข้อมูลใบเบิกถูกแก้ไขจากเครื่องอื่น กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง';
  if(/invalid.*code|unauthorized|permission|invalid.*credential|access required/i.test(message))return 'สิทธิ์ใช้งานไม่ถูกต้อง กรุณาออกจากโหมดแล้วเข้าสู่โหมดทำงานอีกครั้ง';
  if(/inactive/i.test(message))return 'พนักงานหรือประเภทงานนี้ปิดใช้งานแล้ว กรุณาเลือกใหม่';
  if(/network|fetch|timeout/i.test(message))return 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  if(/^[ก-๙]/.test(message)&&message.length<=500)return message;
  return 'บันทึกไม่สำเร็จ กรุณาตรวจข้อมูลและลองอีกครั้ง';
}
export function createSaveGate(){
  const pending=new Set();
  return async(key,save)=>{
    if(pending.has(key))return false;
    pending.add(key);
    try{return await save();}finally{pending.delete(key);}
  };
}
