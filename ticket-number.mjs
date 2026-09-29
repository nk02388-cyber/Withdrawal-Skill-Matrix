export function ticketNumberExists(tickets, number, excludedId = null) {
  const value = String(number ?? '').trim();
  return !!value && tickets.some(ticket => ticket.id !== excludedId && ticket.ticket_no === value);
}

export function suggestTicketNumber(tickets, number) {
  const value = String(number ?? '').trim();
  if (!value) return '';
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
