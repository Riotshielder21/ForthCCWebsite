/**
 * The admin-written welcome email. It is stored as the editor's document (not HTML) and rebuilt here from an
 * allowlist of blocks and marks, so nothing an admin pastes can add scripts, styles or tracking to the email.
 */
export const WELCOME_PLACEHOLDERS = [
  { key: 'firstName', label: 'First name', sample: 'Alex' },
  { key: 'lastName', label: 'Last name', sample: 'Paddler' },
  { key: 'membershipType', label: 'Membership type', sample: 'Adult membership' },
  { key: 'validUntil', label: 'Membership valid until', sample: '01/03/2027' },
  { key: 'membershipNumber', label: 'Membership number', sample: 'FCC-123456' }
];
export const WELCOME_LIMITS = { subject: 150, text: 20000, nodes: 2000, depth: 12 };

const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
export const DEFAULT_WELCOME_EMAIL = {
  enabled: false,
  subject: 'Welcome to Forth Canoe Club, {{firstName}}',
  doc: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Welcome aboard, {{firstName}}!' }] },
    paragraph('Thank you for joining Forth Canoe Club. Your {{membershipType}} is valid until {{validUntil}}.'),
    paragraph('We look forward to seeing you on the water.')
  ] }
};

const BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule', 'hardBreak', 'text']);
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'link']);

const safeHref = (value) => {
  try {
    const url = new URL(String(value));
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
};

/** A clean copy of an editor document, or an Error explaining what is not allowed. */
export function validateWelcomeDoc(doc) {
  let nodes = 0;
  let characters = 0;
  const clean = (node, depth) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('The email body is not valid.');
    if (++nodes > WELCOME_LIMITS.nodes || depth > WELCOME_LIMITS.depth) throw new Error('The email body is too long.');
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text) throw new Error('The email body is not valid.');
      characters += node.text.length;
      if (characters > WELCOME_LIMITS.text) throw new Error(`The email body must be under ${WELCOME_LIMITS.text} characters.`);
      const marks = (Array.isArray(node.marks) ? node.marks : []).filter((mark) => MARKS.has(mark?.type)).flatMap((mark) => {
        if (mark.type !== 'link') return [{ type: mark.type }];
        const href = safeHref(mark.attrs?.href);
        return href ? [{ type: 'link', attrs: { href } }] : [];
      });
      return { type: 'text', text: node.text, ...(marks.length ? { marks } : {}) };
    }
    if (!BLOCKS.has(node.type)) throw new Error(`"${String(node.type).slice(0, 40)}" cannot be used in the welcome email.`);
    const result = { type: node.type };
    if (node.type === 'heading') result.attrs = { level: [1, 2, 3].includes(node.attrs?.level) ? node.attrs.level : 2 };
    if (Array.isArray(node.content) && node.content.length) result.content = node.content.map((child) => clean(child, depth + 1));
    return result;
  };
  if (doc?.type !== 'doc' || !Array.isArray(doc.content)) return new Error('The email body is not valid.');
  try {
    const content = doc.content.map((node) => clean(node, 1));
    if (!characters) return new Error('Write the welcome email before saving.');
    return { type: 'doc', content };
  } catch (error) {
    return error;
  }
}

export const validateWelcomeSubject = (subject) => {
  const value = typeof subject === 'string' ? subject.replace(/\s+/g, ' ').trim() : '';
  if (!value) return new Error('Enter a subject line.');
  if (value.length > WELCOME_LIMITS.subject) return new Error(`The subject must be ${WELCOME_LIMITS.subject} characters or fewer.`);
  return value;
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

/** Replaces {{placeholders}}; unknown ones are left as typed so admins can see the mistake in the preview. */
export const fillPlaceholders = (text, values = {}) => String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key] ?? '') : match);

export const sampleWelcomeValues = () => Object.fromEntries(WELCOME_PLACEHOLDERS.map(({ key, sample }) => [key, sample]));

const MARK_TAGS = { bold: 'strong', italic: 'em', underline: 'u', strike: 's' };
const HEADING_STYLES = { 1: 'font-size:26px;font-weight:900', 2: 'font-size:20px;font-weight:800', 3: 'font-size:16px;font-weight:800' };

const htmlText = (node, values) => (node.marks || []).reduce((html, mark) => mark.type === 'link'
  ? `<a href="${escapeHtml(mark.attrs.href)}" style="color:#0b3153;text-decoration:underline">${html}</a>`
  : `<${MARK_TAGS[mark.type]}>${html}</${MARK_TAGS[mark.type]}>`, escapeHtml(fillPlaceholders(node.text, values)));

const htmlNode = (node, values) => {
  const inner = () => (node.content || []).map((child) => htmlNode(child, values)).join('');
  switch (node.type) {
    case 'text': return htmlText(node, values);
    case 'hardBreak': return '<br>';
    case 'horizontalRule': return '<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">';
    case 'heading': return `<h${node.attrs.level} style="${HEADING_STYLES[node.attrs.level]};margin:24px 0 8px;color:#002147">${inner()}</h${node.attrs.level}>`;
    case 'bulletList': return `<ul style="margin:0 0 16px;padding-left:24px">${inner()}</ul>`;
    case 'orderedList': return `<ol style="margin:0 0 16px;padding-left:24px">${inner()}</ol>`;
    case 'listItem': return `<li style="margin:4px 0">${inner()}</li>`;
    case 'blockquote': return `<blockquote style="margin:0 0 16px;padding:4px 16px;border-left:4px solid #10b981;color:#334155">${inner()}</blockquote>`;
    default: return `<p style="margin:0 0 16px">${inner()}</p>`;
  }
};

/** The body as HTML fragments; `doc` must already have passed validateWelcomeDoc. */
export const welcomeBodyHtml = (doc, values) => (doc.content || []).map((node) => htmlNode(node, values)).join('');

const textNode = (node, values, prefix = '') => {
  const inner = (separator = '') => (node.content || []).map((child) => textNode(child, values)).join(separator);
  switch (node.type) {
    case 'text': {
      const text = fillPlaceholders(node.text, values);
      const link = node.marks?.find((mark) => mark.type === 'link');
      return link && link.attrs.href !== text ? `${text} (${link.attrs.href})` : text;
    }
    case 'hardBreak': return '\n';
    case 'horizontalRule': return '----------';
    case 'bulletList': return (node.content || []).map((item) => `${prefix}- ${textNode(item, values, `${prefix}  `)}`).join('\n');
    case 'orderedList': return (node.content || []).map((item, index) => `${prefix}${index + 1}. ${textNode(item, values, `${prefix}   `)}`).join('\n');
    case 'listItem': return (node.content || []).map((child) => textNode(child, values, prefix)).join('\n');
    case 'blockquote': return inner('\n\n').split('\n').map((line) => `> ${line}`).join('\n');
    default: return inner();
  }
};

/** The plain-text alternative sent alongside the HTML. */
export const welcomeBodyText = (doc, values) => (doc.content || []).map((node) => textNode(node, values)).join('\n\n');

/** Inline styles and table layout work in email clients without the website stylesheet. */
export const welcomeEmailHtml = (bodyHtml, subject) => `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:28px 12px;background:#f8fafc;color:#002147;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px">
      <tr><td style="padding:28px 24px;background:#ffffff;border:1px solid #f1f5f9;border-radius:16px">${bodyHtml}</td></tr>
      <tr><td style="padding:20px 12px;text-align:center;font-size:12px;color:#64748b">Forth Canoe Club, Harrison Park, Edinburgh. Registered Scottish Charity SC050275.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;

const TIER_NAMES = { adult: 'Adult membership', junior: 'Junior membership', family: 'Family membership' };

/** Placeholder values for one member. */
export const welcomeValuesFor = (member = {}) => {
  const validUntil = member.validUntil?.toDate?.() || (member.validUntil instanceof Date ? member.validUntil : null);
  return {
    firstName: member.firstName || 'member',
    lastName: member.lastName || '',
    membershipType: member.justgoProfile?.membershipName || TIER_NAMES[member.membershipTier] || 'membership',
    validUntil: validUntil ? validUntil.toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) : '',
    membershipNumber: member.membershipNumber || ''
  };
};

/** Subject, plain text and HTML for one email. */
export const renderWelcomeEmail = ({ subject, doc }, values) => {
  const filledSubject = fillPlaceholders(subject, values).replace(/[\r\n]+/g, ' ').trim();
  return { subject: filledSubject, body: welcomeBodyText(doc, values), html: welcomeEmailHtml(welcomeBodyHtml(doc, values), filledSubject) };
};
