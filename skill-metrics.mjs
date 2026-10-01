import { workBreakdown } from './operations.mjs?v=3';
// This is a work-history indicator, not a supervisor's competency assessment.
export function automaticSkill(completedCount) {
  if (completedCount >= 12) return 4;
  if (completedCount >= 6) return 3;
  if (completedCount >= 3) return 2;
  if (completedCount >= 1) return 1;
  return 0;
}

// Material rows are the planned lines saved with completed tickets, not confirmed picks.
export function completedJobWorkload(personId, jobId, tickets) {
  const completed = tickets.filter(ticket =>
    ticket.assignee_id === personId && ticket.job_type_id === jobId && ticket.status === 'done'
  );
  return {
    tickets: completed.length,
    materialLines: completed.reduce((sum, ticket) => sum + (Array.isArray(ticket.materials) ? ticket.materials.length : 0), 0),
  };
}

export function personPerformance(personId, tickets) {
  const own = tickets.filter(ticket => ticket.assignee_id === personId);
  const done = own.filter(ticket => ticket.status === 'done');
  const partial = own.filter(ticket => ticket.status === 'partial');
  const closed = done.length + partial.length;
  const durations = done.map(ticket => workBreakdown(ticket)?.activeMinutes??null).filter(value => value !== null).sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const medianMinutes = durations.length ? (durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2) : null;
  return {
    total: own.length,
    done: done.length,
    partial: partial.length,
    open: own.filter(ticket => ['queued', 'active', 'paused'].includes(ticket.status)).length,
    completionRate: closed ? Math.round(done.length / closed * 100) : null,
    medianMinutes,
  };
}
