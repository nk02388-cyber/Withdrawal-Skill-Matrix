import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketNumberExists, suggestTicketNumber, isDuplicateTicketNumberError } from '../ticket-number.mjs';

const tickets = [{id:'a',ticket_no:'WD-001'},{id:'b',ticket_no:'WD-001-2'}];
test('detects an existing ticket number while allowing the current ticket in edits', () => {
  assert.equal(ticketNumberExists(tickets,' WD-001 '),true);
  assert.equal(ticketNumberExists(tickets,'WD-001','a'),false);
});
test('suggests a free number within the database length limit', () => {
  assert.equal(suggestTicketNumber(tickets,'WD-001'),'WD-001-3');
  assert.equal(suggestTicketNumber([], 'X'.repeat(80)).length,80);
});
test('recognizes only the ticket number unique constraint', () => {
  assert.equal(isDuplicateTicketNumberError({code:'23505',message:'duplicate key value violates unique constraint "tickets_ticket_no_key"'}),true);
  assert.equal(isDuplicateTicketNumberError({code:'23505',message:'other_key'}),false);
});
