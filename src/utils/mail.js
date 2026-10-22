const headerSafe = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

// Non-ASCII text (e.g. the £ in receipts) must be encoded or Gmail shows it garbled.
const encodeHeader = (value) => {
  const safe = headerSafe(value);
  return /^[\x20-\x7e]*$/.test(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
};

const wrap76 = (text) => text.match(/.{1,76}/g)?.join('\r\n') || '';

/** Builds a base64url RFC 2822 message for the Gmail API. Rejects recipients that are not a single plain address. */
export const buildRawEmail = ({ fromName, from, to, subject, body }) => {
  const recipient = headerSafe(to);
  if (!/^[^\s<>,;"]+@[^\s<>,;"]+$/.test(recipient) || recipient !== String(to).trim()) throw new Error('Invalid recipient address.');
  const message = [
    `From: ${encodeHeader(fromName)} <${headerSafe(from)}>`,
    `To: ${recipient}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(String(body ?? '').replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))
  ].join('\r\n');
  return Buffer.from(message).toString('base64url');
};
