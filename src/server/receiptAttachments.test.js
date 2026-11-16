import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { bookingCalendar, loadReceiptImage, receiptAttachments, receiptPdf } from './receiptAttachments.js';
import { buildReceiptSummary, receiptEmailHtml } from '../utils/receipt.js';

const event = { id: 'course', name: 'Course; boats', lineId: 'course', category: 'EVENTS', pricePence: 2500,
  eventSchedule: { mode: 'weekly', startDate: '2027-03-21', startTime: '18:00', endTime: '20:00', weeks: 2, timeZone: 'Europe/London' } };

test('booked course calendars include every session with London daylight-saving rules and no attendee data', () => {
  const calendar = bookingCalendar('FCC-TEST', [event]).toString();
  assert.equal(calendar.match(/BEGIN:VEVENT/g).length, 2);
  assert.match(calendar, /DTSTART;TZID=Europe\/London:20270321T180000/);
  assert.match(calendar, /DTSTART;TZID=Europe\/London:20270328T180000/);
  assert.match(calendar, /DTEND;TZID=Europe\/London:20270328T200000/);
  assert.match(calendar, /BEGIN:VTIMEZONE/);
  assert.match(calendar, /SUMMARY:Course\\; boats/);
  assert.equal(bookingCalendar('FCC-TEST', [{ name: 'Old event', category: 'EVENTS' }]), null);
  assert.throws(() => bookingCalendar('FCC-TEST', [{ ...event, eventSchedule: {} }]), /Choose/);
  assert.equal(calendar.match(/UID:.+/g).length, new Set(calendar.match(/UID:.+/g)).size);
});

test('receipt PDF is a real PDF and images are deduplicated and referenced by CID in the HTML', async () => {
  const imageUrl = 'https://images.example.test/event.jpg';
  const items = [{ ...event, imageUrl }, { ...event, lineId: 'second', imageUrl }];
  const receipt = buildReceiptSummary('FCC-TEST', { items, totalPence: 5000 });
  let reads = 0;
  const result = await receiptAttachments({ receipt, orderRef: 'FCC-TEST', items,
    loadImage: async () => { reads += 1; return { filename: 'event.jpg', contentType: 'image/jpeg', content: Buffer.from('image') }; } });
  assert.equal(reads, 1);
  assert.deepEqual(result.attachments.map(({ contentType }) => contentType), ['application/pdf', 'text/calendar', 'image/jpeg']);
  assert.match(result.attachments[0].content.toString('ascii', 0, 8), /^%PDF-/);
  assert.match(receiptEmailHtml(receipt, '', result.images), /src="cid:event-0@forthcanoeclub.co.uk"/);
  assert.doesNotMatch(receiptEmailHtml(receipt, '', result.images), /src="https:\/\/images/);
  assert.match((await receiptPdf({ orderRef: 'FCC-LINK', copy: 'Limited receipt copy' })).toString('ascii', 0, 8), /^%PDF-/);
});

test('only bounded images from the club storage product folder are read, never arbitrary URLs', async () => {
  let reads = 0;
  const storage = { bucket: (name) => {
    assert.equal(name, 'demo-fcc.appspot.com');
    return { file: (path) => {
      assert.equal(path, 'products/P0001/image.jpg');
      reads += 1;
      return { getMetadata: async () => [{ size: 3, contentType: 'image/jpeg' }], createReadStream: () => Readable.from([Buffer.from('abc')]) };
    } };
  } };
  const options = { projectId: 'demo-fcc', storage };
  const image = await loadReceiptImage('https://firebasestorage.googleapis.com/v0/b/demo-fcc.appspot.com/o/products%2FP0001%2Fimage.jpg?alt=media', options);
  assert.equal(image.content.toString(), 'abc');
  for (const url of ['http://127.0.0.1/private', 'https://images.example.test/a.jpg', '/relative.jpg',
    'https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/products%2FP0001%2Fimage.jpg',
    'https://firebasestorage.googleapis.com/v0/b/demo-fcc.appspot.com/o/private%2Fimage.jpg',
    'https://firebasestorage.googleapis.com/v0/b/demo-fcc.appspot.com/o/products%GGimage.jpg']) {
    assert.equal(await loadReceiptImage(url, options), null);
  }
  assert.equal(reads, 1);
});

test('invalid metadata and oversized streams cannot become inline email images', async () => {
  const url = 'https://firebasestorage.googleapis.com/v0/b/demo-fcc.appspot.com/o/products%2FP0001%2Fimage.jpg';
  const file = { getMetadata: async () => [{ size: 'unknown', contentType: 'image/jpeg' }],
    createReadStream: () => { throw new Error('Invalid metadata must not start a download'); } };
  const options = { projectId: 'demo-fcc', storage: { bucket: () => ({ file: () => file }) } };
  assert.equal(await loadReceiptImage(url, options), null);
  file.getMetadata = async () => [{ size: 100, contentType: 'image/jpeg' }];
  file.createReadStream = () => Readable.from([Buffer.alloc(2 * 1024 * 1024 + 1)]);
  await assert.rejects(loadReceiptImage(url, options), /size limit/);
});
