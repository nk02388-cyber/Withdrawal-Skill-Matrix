export function purgeConfirmationError(ticket,confirmation,reason){
 if(!ticket?.deleted_at)return 'ลบถาวรได้เฉพาะใบเบิกในถังขยะ';
 if(String(confirmation||'').trim()!==ticket.ticket_no)return 'พิมพ์เลขที่ใบเบิกให้ตรงเพื่อยืนยันลบถาวร';
 if(!String(reason||'').trim()||String(reason).length>1000)return 'กรุณาระบุเหตุผลการลบถาวร ไม่เกิน 1000 ตัวอักษร';
 return '';
}
