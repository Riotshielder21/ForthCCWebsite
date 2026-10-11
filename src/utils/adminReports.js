export const reportDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string') {
    const british = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (british) {
      const [, day, month, year] = british;
      const parsed = new Date(`${year}-${month}-${day}T23:59:59.999Z`);
      if (parsed.getUTCDate() !== Number(day) || parsed.getUTCMonth() + 1 !== Number(month)) return null;
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
    const parsed = new Date(value.length === 10 ? `${value}T23:59:59.999Z` : value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return null;
};

export const memberState = (fields, now = new Date()) => {
  const expiry = reportDate(fields.expiry);
  if (expiry && new Date(expiry) < now) return 'Expired';
  if (fields.status && !/^active$/i.test(fields.status)) return fields.status;
  return expiry ? 'Current' : 'Unverified expiry';
};

export const subscriptionWarning = (fields) => Boolean(fields.stripeSubscriptionId
  || (fields.items || []).some((item) => item.type === 'subscription'));

export const orderReport = (id, fields) => ({
  id,
  email: fields.email || '',
  status: fields.status || 'unknown',
  total: Number.isFinite(Number(fields.total)) ? Number(fields.total) : 0,
  createdAt: reportDate(fields.createdAt),
  paidAt: reportDate(fields.paidAt),
  stripeSubscriptionId: fields.stripeSubscriptionId || '',
  stripePaymentIntentId: fields.stripePaymentIntentId || '',
  subscriptionWarning: subscriptionWarning(fields),
  items: (Array.isArray(fields.items) ? fields.items : []).map((item) => ({
    name: String(item.name || item.id || ''), category: String(item.category || ''),
    type: String(item.type || ''), price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    ...(item.eventSchedule ? { eventSchedule: item.eventSchedule } : {})
  }))
});

export const memberReport = (id, fields) => ({
  id, name: fields.name || '', email: fields.email || '', scaId: fields.scaId || id,
  expiry: reportDate(fields.expiry), status: memberState(fields), lastUpdated: reportDate(fields.lastUpdated)
});

export const uniqueReportEmails = (records) => [...new Set(records.map((record) => String(record.email || '').trim().toLowerCase())
  .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))].sort();

export const reportCsv = (headers, rows) => [headers, ...rows].map((row) => row.map((value) => {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}).join(',')).join('\r\n');