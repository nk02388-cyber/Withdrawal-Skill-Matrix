const bangkokFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function toBangkokInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(bangkokFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function fromBangkokInput(value, original = null) {
  if (!value) return null;
  if (original && value === toBangkokInput(original)) return original;
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}+07:00`);
  if (!Number.isFinite(date.getTime()) || toBangkokInput(date) !== normalized) return null;
  return date.toISOString();
}

export function timeEditError(status, startedAt, endedAt, now = Date.now(), originalStartedAt = null) {
  const start = startedAt ? new Date(startedAt).getTime() : null;
  const end = endedAt ? new Date(endedAt).getTime() : null;
  if ((startedAt && !Number.isFinite(start)) || (endedAt && !Number.isFinite(end))) return 'รูปแบบเวลาไม่ถูกต้อง';
  if ((start !== null && start > now) || (end !== null && end > now)) return 'เวลาเริ่มและสิ้นสุดต้องไม่เป็นเวลาในอนาคต';
  if (status === 'queued' && (start !== null || end !== null)) return 'งานรอดำเนินการยังไม่มีเวลาเริ่มหรือสิ้นสุด';
  if (['active', 'paused'].includes(status) && (start === null || end !== null)) return 'งานที่กำลังทำหรือพักต้องมีเฉพาะเวลาเริ่ม';
  if (['done', 'partial'].includes(status) && (start === null || end === null)) return 'งานที่ปิดแล้วต้องมีเวลาเริ่มและสิ้นสุด';
  if (status === 'cancelled' && end === null) return 'งานที่ยกเลิกต้องมีเวลาสิ้นสุด';
  if (status === 'cancelled' && Boolean(originalStartedAt) !== Boolean(startedAt)) return 'งานที่ยกเลิกแก้เวลาเริ่มได้เฉพาะใบที่เคยเริ่มงาน';
  if (start !== null && end !== null && end < start) return 'เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม';
  return '';
}
