import { randomUUID } from 'node:crypto';

const headerSafe = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

// Non-ASCII text (e.g. the £ in receipts) must be encoded or Gmail shows it garbled.
const encodeHeader = (value) => {
  const safe = headerSafe(value);
  return /^[\x20-\x7e]*$/.test(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
};

const wrap76 = (text) => text.match(/.{1,76}/g)?.join('\r\n') || '';

/** Builds a base64url RFC 2822 message for the Gmail API. Rejects recipients that are not a single plain address. */
export const buildRawEmail = ({ fromName, from, to, subject, body, html, replyTo }) => {
  const normalizeAddress = (value, label) => {
    const address = headerSafe(value);
    if (!/^[^\s<>,;"]+@[^\s<>,;"]+$/.test(address) || address !== String(value).trim()) {
      throw new Error(`Invalid ${label} address.`);
    }
    return address;
  };
  const recipient = normalizeAddress(to, 'recipient');
  const replyToAddress = replyTo ? normalizeAddress(replyTo, 'Reply-To') : '';
  const encodedBody = (text) => wrap76(Buffer.from(String(text ?? '').replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'));
  const boundary = `fcc-${randomUUID()}`;
  const content = html ? [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody(body),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody(html),
    `--${boundary}--`
  ] : [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody(body)
  ];
  const message = [
    `From: ${encodeHeader(fromName)} <${headerSafe(from)}>`,
    `To: ${recipient}`,
    ...(replyToAddress ? [`Reply-To: ${replyToAddress}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    ...content
  ].join('\r\n');
  return Buffer.from(message).toString('base64url');
};
