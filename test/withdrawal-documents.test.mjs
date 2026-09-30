import test from 'node:test';
import assert from 'node:assert/strict';
import {splitTicketNumbers,ticketDocumentCount,totalDocuments,ticketNumbersError} from '../withdrawal-documents.mjs';
import {ticketNumberExists,suggestTicketNumber} from '../ticket-number.mjs';
test('count grouped documents separated by commas, spaces and mixed delimiters',()=>{
  assert.deepEqual(splitTicketNumbers(' PK-001, PK-002  PK-003,\n PK-004 '),['PK-001','PK-002','PK-003','PK-004']);
  assert.equal(ticketDocumentCount({ticket_no:'PK-001, PK-002 PK-003',fg_code:'FG'}),3);
  assert.equal(ticketDocumentCount({ticket_no:'PK-001 PK-002'}),2);
  assert.equal(totalDocuments([{ticket_no:'PK-001, PK-002'},{ticket_no:'PK-003'}]),3);
});
test('legacy training names and missing numbers keep one work unit',()=>{
  assert.equal(ticketDocumentCount({ticket_no:'อบรม HALAL'}),1);
  assert.equal(ticketDocumentCount({}),1);
  assert.equal(ticketDocumentCount({ticket_no:'PK-001 pk-001',fg_code:'FG'}),1);
  assert.match(ticketNumbersError('PK-001,pk-001'),/ซ้ำ/);
  assert.match(ticketNumbersError(' , '),/ระบุ/);
  assert.equal(ticketNumbersError('PK-001 PK-002'),'');
});
test('detect individual collisions with existing grouped work, including edits',()=>{
  const tickets=[{id:'a',ticket_no:'PK-001, PK-002'},{id:'b',ticket_no:'PK-003'}];
  assert.equal(ticketNumberExists(tickets,'pk-002 PK-004'),true);
  assert.equal(ticketNumberExists(tickets,'PK-001 PK-002','a'),false);
  assert.equal(ticketNumberExists(tickets,'PK-004 PK-005'),false);
  assert.equal(suggestTicketNumber(tickets,'PK-001 PK-002'),'');
});
