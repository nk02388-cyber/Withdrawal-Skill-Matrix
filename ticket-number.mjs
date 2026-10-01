import {splitTicketNumbers,ticketReferences} from './withdrawal-documents.mjs';
export function ticketNumberExists(tickets, number, excludedId = null) {
  const refs = splitTicketNumbers(number).map(ref=>ref.toUpperCase());
  return refs.length>0 && tickets.some(ticket => ticket.id !== excludedId && ticketReferences(ticket).some(ref=>refs.includes(ref.toUpperCase())));
}

export function ticketNumberConflicts(tickets, number, excludedId = null) {
  const requested=new Set(splitTicketNumbers(number).map(ref=>ref.toUpperCase()));
  return tickets.filter(ticket=>ticket.id!==excludedId).flatMap(ticket=>ticketReferences(ticket)
    .filter(ref=>requested.has(ref.toUpperCase()))
    .map(ref=>({number:ref,ticketId:ticket.id,deleted:!!ticket.deleted_at,status:ticket.status})));
}

export function ticketConflictText(conflicts) {
  if(!conflicts.length)return 'เลขที่ใบเบิกถูกใช้แล้ว กรุณาโหลดข้อมูลใหม่และตรวจรายการปกติหรือถังขยะ';
  return conflicts.map(c=>`${c.number}: ${c.deleted?'อยู่ในถังขยะ เลขเดิมยังถูกเก็บไว้ กู้คืนใบเดิมหรือใช้เลขใบเบิกใหม่':'มีอยู่ในรายการใบเบิกแล้ว'}`).join('\n');
}

export function suggestTicketNumber(tickets, number) {
  const value = String(number ?? '').trim();
  if (!value) return '';
  if(splitTicketNumbers(value).length>1)return '';
  for (let suffix = 2; suffix < 10000; suffix++) {
    const tail = `-${suffix}`;
    const candidate = `${value.slice(0, 80 - tail.length)}${tail}`;
    if (!ticketNumberExists(tickets, candidate)) return candidate;
  }
  return '';
}

export function isDuplicateTicketNumberError(error) {
  return error?.code === '23505' && /tickets_ticket_no_key|เลขที่ใบเบิกบางใบมีอยู่แล้ว/.test(error.message || '');
}
