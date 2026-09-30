export function splitTicketNumbers(value){
  return String(value??'').trim().split(/[\s,，]+/u).filter(Boolean);
}
export function ticketReferences(ticket){
  const value=String(ticket.ticket_no??'').trim();
  const refs=splitTicketNumbers(value);
  // Legacy non-withdrawal work can have a name such as "อบรม HALAL".
  if(!ticket.fg_code&&!/[,，]/u.test(value)&&!refs.every(ref=>/\d/.test(ref)))return value?[value]:[];
  return refs;
}
export function ticketDocumentCount(ticket){return Math.max(1,new Set(ticketReferences(ticket).map(ref=>ref.toUpperCase())).size);}
export function totalDocuments(tickets){return tickets.reduce((sum,ticket)=>sum+ticketDocumentCount(ticket),0);}
export function ticketNumbersError(value){
  const refs=splitTicketNumbers(value);
  if(!refs.length)return 'กรุณาระบุเลขที่ใบเบิก';
  if(new Set(refs.map(ref=>ref.toUpperCase())).size!==refs.length)return 'มีเลขที่ใบเบิกซ้ำในช่องนี้ กรุณาตรวจสอบ';
  return '';
}
