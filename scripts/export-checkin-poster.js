import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const [site, destination, ...extra] = process.argv.slice(2);
if (!site || !destination || extra.length) {
  throw new Error('Usage: node scripts/export-checkin-poster.js https://your-club-website check-in-poster.pdf');
}
const origin = new URL(site);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash
    || !['', '/'].includes(origin.pathname)) {
  throw new Error('Use the public HTTPS website origin, without a path, query or credentials.');
}
const url = new URL('/check-ins', origin).href;
const code = await QRCode.toBuffer(url, { width: 1000, margin: 4, errorCorrectionLevel: 'M' });
const pdf = new PDFDocument({ size: 'A4', margin: 50 });
const writing = pipeline(pdf, createWriteStream(destination, { flags: 'wx' }));
pdf.fontSize(28).text('Forth Canoe Club', { align: 'center' });
pdf.moveDown().fontSize(24).text('Check in before paddling', { align: 'center' });
pdf.image(code, (pdf.page.width - 380) / 2, 165, { width: 380 });
pdf.fontSize(16).text('Scan with your phone camera', 50, 560, { align: 'center' });
pdf.moveDown().fontSize(12).text(url, { align: 'center', link: url });
pdf.moveDown().fontSize(14).text('Choose today\'s session and follow the on-screen steps.', { align: 'center' });
pdf.moveDown().fontSize(12).text('Need help? Speak to the session leader.', { align: 'center' });
pdf.end();
await writing;
console.log(`Created ${destination}. Confirm the website address and scan the QR code before printing.`);
