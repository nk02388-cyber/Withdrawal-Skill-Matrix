import test from 'node:test';
import assert from 'node:assert/strict';
import {purgeConfirmationError} from '../trash.mjs';
test('permanent removal requires a trashed row, exact grouped numbers and a reason',()=>{
 const ticket={ticket_no:'PK-1, PK-2',deleted_at:'2026-10-01'};
 assert.equal(purgeConfirmationError(ticket,'PK-1, PK-2','รายการทดสอบ'), '');
 assert.match(purgeConfirmationError(ticket,'PK-1','รายการทดสอบ'),/พิมพ์เลขที่/);
 assert.match(purgeConfirmationError(ticket,'PK-1, PK-2',''),/เหตุผล/);
 assert.match(purgeConfirmationError({...ticket,deleted_at:null},'PK-1, PK-2','รายการทดสอบ'),/เฉพาะ/);
});
