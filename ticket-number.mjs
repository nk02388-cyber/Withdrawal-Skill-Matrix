import {splitTicketNumbers,ticketReferences} from './withdrawal-documents.mjs';
export function ticketNumberExists(tickets, number, excludedId = null) {
  const refs = splitTicketNumbers(number).map(ref=>ref.toUpperCase());
  return refs.length>0 && tickets.some(ticket => ticket.id !== excludedId && ticketReferences(ticket).some(ref=>refs.includes(ref.toUpperCase())));
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
  return error?.code === '23505' && /tickets_ticket_no_key/.test(error.message || '');
}
