import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBangkokInput, timeEditError, toBangkokInput } from '../ticket-time.mjs';

test('Bangkok datetime input keeps the intended instant and preserves unchanged precision', () => {
  const original = '2026-09-29T04:12:37.456+00:00';
  assert.equal(toBangkokInput(original), '2026-09-29T11:12:37');
  assert.equal(fromBangkokInput('2026-09-29T11:12:37', original), original);
  assert.equal(fromBangkokInput('2026-09-29T11:15:00'), '2026-09-29T04:15:00.000Z');
  assert.equal(fromBangkokInput('2026-02-30T11:15:00'), null);
});

test('time rules follow ticket status and reject reversed or future times', () => {
  const now = Date.parse('2026-09-30T00:00:00Z');
  const start = '2026-09-29T01:00:00Z';
  const end = '2026-09-29T02:00:00Z';
  assert.equal(timeEditError('queued', null, null, now), '');
  assert.match(timeEditError('queued', start, null, now), /รอดำเนินการ/);
  assert.equal(timeEditError('active', start, null, now), '');
  assert.match(timeEditError('active', start, end, now), /เฉพาะเวลาเริ่ม/);
  assert.equal(timeEditError('done', start, end, now), '');
  assert.match(timeEditError('done', end, start, now), /ไม่ก่อน/);
  assert.match(timeEditError('done', start, '2026-10-01T00:00:00Z', now), /อนาคต/);
  assert.equal(timeEditError('cancelled', null, end, now, null), '');
  assert.match(timeEditError('cancelled', start, end, now, null), /เคยเริ่มงาน/);
});
