import { randomUUID } from 'node:crypto';

const headerSafe = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

// Non-ASCII text (e.g. the £ in receipts) must be encoded or Gmail shows it garbled.
const encodeHeader = (value) => {
  const safe = headerSafe(value);
  return /^[\x20-\x7e]*$/.test(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
};

const wrap76 = (text) => text.match(/.{1,76}/g)?.join('\r\n') || '';

/** Builds a base64url RFC 2822 message for the Gmail API. Rejects recipients that are not a single plain address. */
export const buildRawEmail = ({ fromName, from, to, subject, body, html, replyTo, attachments = [] }) => {
  const normalizeAddress = (value, label) => {
    const address = headerSafe(value);
    if (!/^[^\s<>,;"@]+@[^\s<>,;"@]+$/.test(address) || address !== String(value).trim()) {
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
  if (!Array.isArray(attachments) || attachments.length > 65) throw new Error('Invalid email attachments.');
  let totalBytes = 0;
  const parts = attachments.map(({ filename, contentType, content: bytes, contentId }) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(filename || '')
      || !/^(application\/pdf|text\/calendar|image\/(?:png|jpeg|webp))$/.test(contentType || '')
      || !Buffer.isBuffer(bytes) || (contentId && (!html || !/^[a-zA-Z0-9_.@-]{1,100}$/.test(contentId)))) {
      throw new Error('Invalid email attachment.');
    }
    totalBytes += bytes.length;
    if (totalBytes > 10 * 1024 * 1024) throw new Error('Email attachments exceed 10 MB.');
    return { inline: Boolean(contentId), part: [
      `Content-Type: ${contentType}${contentType === 'text/calendar' ? '; charset=UTF-8; method=PUBLISH' : ''}; name="${filename}"`,
      `Content-Disposition: ${contentId ? 'inline' : 'attachment'}; filename="${filename}"`,
      ...(contentId ? [`Content-ID: <${contentId}>`] : []),
      'Content-Transfer-Encoding: base64', '', wrap76(bytes.toString('base64'))
    ].join('\r\n') };
  });
  const inlineParts = parts.filter((part) => part.inline);
  const attachmentsParts = parts.filter((part) => !part.inline);
  const relatedBoundary = `fcc-related-${randomUUID()}`;
  const bodyContent = inlineParts.length ? [
    `Content-Type: multipart/related; boundary="${relatedBoundary}"; type="multipart/alternative"`, '',
    `--${relatedBoundary}`, ...content,
    ...inlineParts.flatMap(({ part }) => [`--${relatedBoundary}`, part]),
    `--${relatedBoundary}--`
  ] : content;
  const mixedBoundary = `fcc-mixed-${randomUUID()}`;
  const messageContent = attachmentsParts.length ? [
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, '',
    `--${mixedBoundary}`, ...bodyContent,
    ...attachmentsParts.flatMap(({ part }) => [`--${mixedBoundary}`, part]),
    `--${mixedBoundary}--`
  ] : bodyContent;
  const message = [
    `From: ${encodeHeader(fromName)} <${headerSafe(from)}>`,
    `To: ${recipient}`,
    ...(replyToAddress ? [`Reply-To: ${replyToAddress}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    ...messageContent
  ].join('\r\n');
  return Buffer.from(message).toString('base64url');
};
