import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketNumberExists, ticketNumberConflicts, ticketConflictText, suggestTicketNumber, isDuplicateTicketNumberError } from '../ticket-number.mjs';

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
  assert.equal(isDuplicateTicketNumberError({code:'23505',message:'เลขที่ใบเบิกบางใบมีอยู่แล้ว กรุณาตรวจสอบแต่ละเลขที่'}),true);
});

test('grouped creation identifies the reserved number in trash without blaming the unused number',()=>{
  const deleted={id:'old',ticket_no:'PK2610-0035',deleted_at:'2026-09-30',status:'cancelled'};
  const conflicts=ticketNumberConflicts([deleted],'PK2610-0034, pk2610-0035');
  assert.equal(conflicts.length,1);assert.equal(conflicts[0].number,'PK2610-0035');assert.equal(conflicts[0].deleted,true);
  assert.match(ticketConflictText(conflicts),/PK2610-0035: อยู่ในถังขยะ/);
  assert.doesNotMatch(ticketConflictText(conflicts),/0034/);
  assert.equal(ticketNumberConflicts([deleted],'PK2610-0035','old').length,0);
});
