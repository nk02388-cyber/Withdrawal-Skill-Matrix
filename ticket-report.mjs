const bangkokDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function bangkokDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(bangkokDateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function filterTickets(tickets, filters) {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  const from = filters.dateFrom || '';
  const to = filters.dateTo || '';
  if (from && to && from > to) return [];
  return tickets.filter(ticket => {
    const date = bangkokDate(ticket.created_at);
    return (!query || String(ticket.ticket_no || '').toLocaleLowerCase().includes(query))
      && (!filters.assigneeId || ticket.assignee_id === filters.assigneeId)
      && (!filters.jobId || ticket.job_type_id === filters.jobId)
      && (!filters.status || ticket.status === filters.status)
      && (!from || date >= from)
      && (!to || date <= to);
  });
}
