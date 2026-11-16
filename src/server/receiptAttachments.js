import PDFDocument from 'pdfkit';
import { eventSessions } from '../utils/catalogue.js';
import { receiptEmailCopy } from '../utils/receipt.js';

const escapeCalendarText = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
  .replace(/,/g, '\\,').replace(/;/g, '\\;');
const fold = (line) => {
  const lines = [];
  let current = '';
  for (const character of line) {
    if (Buffer.byteLength(current + character) > 75) {
      lines.push(current);
      current = ' ';
    }
    current += character;
  }
  return [...lines, current].join('\r\n');
};

export const bookingCalendar = (orderRef, items) => {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const events = items.filter((item) => item.category === 'EVENTS' && item.eventSchedule);
  if (!events.length) return null;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Forth Canoe Club//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Europe/London', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100',
    'DTSTART:19810329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'DTSTART:19961027T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE'];
  for (const [index, item] of events.entries()) {
    for (const session of eventSessions(item.eventSchedule)) {
      const date = session.date.replace(/-/g, '');
      lines.push('BEGIN:VEVENT', `UID:${escapeCalendarText(`${orderRef}-${index}-${date}`)}@forthcanoeclub.co.uk`,
        `DTSTAMP:${stamp}`, `DTSTART;TZID=Europe/London:${date}T${session.startTime.replace(':', '')}00`,
        `DTEND;TZID=Europe/London:${date}T${session.endTime.replace(':', '')}00`,
        `SUMMARY:${escapeCalendarText(item.name)}`, 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return Buffer.from(`${lines.map(fold).join('\r\n')}\r\n`);
};

export const receiptPdf = (receipt) => new Promise((resolve, reject) => {
  const document = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Forth Canoe Club receipt ${receipt.orderRef}` } });
  const chunks = [];
  document.on('data', (chunk) => chunks.push(chunk));
  document.on('error', reject);
  document.on('end', () => resolve(Buffer.concat(chunks)));
  document.fontSize(18).text('Forth Canoe Club SCIO');
  document.moveDown().fontSize(11).text(receipt.copy || receiptEmailCopy(receipt));
  document.end();
});

export const receiptAttachments = async ({ receipt, orderRef, items, loadImage }) => {
  const attachments = [{ filename: 'receipt.pdf', contentType: 'application/pdf', content: await receiptPdf(receipt) }];
  const calendar = bookingCalendar(orderRef, items);
  if (calendar) attachments.push({ filename: 'booked-events.ics', contentType: 'text/calendar', content: calendar });
  const images = new Map();
  let imageBytes = 0;
  for (const item of items.filter((item) => item.category === 'EVENTS' && item.imageUrl)) {
    if (images.has(item.imageUrl)) continue;
    const image = await loadImage(item.imageUrl);
    if (!image) continue;
    if (images.size >= 60 || imageBytes + image.content.length > 8 * 1024 * 1024) {
      console.warn('Receipt image kept hosted: the email attachment budget has been reached.');
      continue;
    }
    imageBytes += image.content.length;
    const contentId = `event-${images.size}@forthcanoeclub.co.uk`;
    images.set(item.imageUrl, contentId);
    attachments.push({ ...image, contentId });
  }
  return { attachments, images };
};

export const loadReceiptImage = async (value, { projectId, storage }) => {
  let url;
  try { url = new URL(value); }
  catch {
    console.warn('Receipt image cannot be attached: no absolute image URL.');
    return null;
  }
  const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
  let bucket, path;
  try {
    bucket = match && decodeURIComponent(match[1]);
    path = match && decodeURIComponent(match[2]);
  } catch {
    console.warn('Receipt image kept as a hosted image: its storage URL is malformed.');
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.username || url.password
    || ![`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`].includes(bucket)
    || !/^products\/[\w-]+\/[\w-]+\.(png|jpg|webp)$/.test(path || '')) {
    console.warn('Receipt image kept as a hosted image: only club-uploaded product images can be attached.');
    return null;
  }
  const file = storage.bucket(bucket).file(path);
  const [metadata] = await file.getMetadata();
  const metadataSize = Number(metadata.size);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(metadata.contentType)
    || !Number.isFinite(metadataSize) || metadataSize <= 0 || metadataSize > 2 * 1024 * 1024) {
    console.warn('Receipt image kept as a hosted image: attachment type or size is unsupported.');
    return null;
  }
  const chunks = [];
  let size = 0;
  const stream = file.createReadStream();
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      stream.destroy();
      throw new Error('Receipt image exceeded the attachment size limit.');
    }
    chunks.push(chunk);
  }
  return { filename: path.split('/').at(-1), contentType: metadata.contentType, content: Buffer.concat(chunks) };
};
