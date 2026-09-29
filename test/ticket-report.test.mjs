import test from 'node:test';
import assert from 'node:assert/strict';
import { bangkokDate, filterTickets } from '../ticket-report.mjs';

const tickets = [
  { ticket_no:'WD-001', assignee_id:'a', job_type_id:'pick', status:'queued', created_at:'2026-09-28T16:59:00Z' },
  { ticket_no:'WD-002', assignee_id:'b', job_type_id:'pack', status:'active', created_at:'2026-09-28T17:00:00Z' },
  { ticket_no:'WD-003', assignee_id:'a', job_type_id:'pick', status:'done', created_at:'2026-09-29T16:59:59Z' },
  { ticket_no:'WD-004', assignee_id:'a', job_type_id:'pack', status:'done', created_at:'2026-09-29T17:00:00Z' }
];

test('date boundaries use Thailand time and include both selected days', () => {
  assert.equal(bangkokDate(tickets[0].created_at), '2026-09-28');
  assert.equal(bangkokDate(tickets[1].created_at), '2026-09-29');
  assert.deepEqual(filterTickets(tickets,{dateFrom:'2026-09-29',dateTo:'2026-09-29'}).map(t=>t.ticket_no),['WD-002','WD-003']);
});

test('ticket number, staff, job and status combine', () => {
  assert.deepEqual(filterTickets(tickets,{query:'wd-00',assigneeId:'a',jobId:'pick',status:'done'}).map(t=>t.ticket_no),['WD-003']);
  assert.deepEqual(filterTickets(tickets,{query:'003'}).map(t=>t.ticket_no),['WD-003']);
});

test('invalid date range yields no tickets', () => {
  assert.deepEqual(filterTickets(tickets,{dateFrom:'2026-09-30',dateTo:'2026-09-29'}),[]);
});
