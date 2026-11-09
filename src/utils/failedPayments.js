import { ageOn, sanitizePerson } from './checkout.js';
import { NEXT_YEAR_LINE_SUFFIX } from './pricing.js';

/**
 * Failed payments. Stripe retries a failed monthly debit on its own schedule (Billing → Revenue recovery → Retries) and
 * cancels the subscription once every retry has failed. The website emails the member at each failure, and on the
 * final one gives links to restart the payments (a new checkout for the same items) or confirm they are stopping. A
 * one-off bank payment that fails leaves the order with links to retry it (a new checkout with the same details) or
 * cancel it. Nothing is charged twice: a retry or restart is a normal checkout, which re-checks stock, codes and price.
 */

export const RETRY_LINK_DAYS = 30;
const money = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;
export const dateLabel = (seconds) => new Date(seconds * 1000)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
const listText = (values) => {
  const items = [...new Set(values.filter(Boolean))];
  return items.length <= 1 ? items[0] || '' : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
};

/** An emailed link's key is `ID.TOKEN`; returns the two parts, or null when it is malformed. */
export const splitLinkKey = (key) => {
  const value = String(key || '');
  const separator = value.lastIndexOf('.');
  const id = value.slice(0, separator);
  const token = value.slice(separator + 1);
  return separator > 0 && /^[A-Za-z0-9_-]{1,100}$/.test(id) && /^[a-f0-9]{64}$/.test(token) ? { id, token } : null;
};

/** The start of the earliest period an invoice charges for (its line periods; the invoice's own period is the previous one). */
export const invoicePeriodStart = (invoice) => {
  const starts = (invoice?.lines?.data || []).map((line) => line.period?.start).filter((value) => Number.isFinite(value) && value > 0);
  return starts.length ? Math.min(...starts) : (invoice?.period_end || 0);
};

/**
 * When a cancelled subscription was paid up to, in seconds: the start of the earliest period still unpaid, otherwise
 * the end of the current period.
 */
export const paidUpTo = (unpaidInvoices, periodEndSeconds) => {
  const starts = (unpaidInvoices || []).map(invoicePeriodStart).filter((value) => value > 0);
  return starts.length ? Math.min(...starts) : periodEndSeconds || 0;
};

/** The club-year choice for a basket line covering `years`, relative to `currentYear`; null when none are on sale. */
const choiceFor = (years, currentYear) => {
  const thisYear = years.has(currentYear);
  const nextYear = years.has(currentYear + 1);
  if (thisYear && nextYear) return 'both';
  if (nextYear) return 'next';
  return thisYear ? 'this' : null;
};

/**
 * Rebuilds the basket a failed one-off order was made from, so the customer can pay again without re-entering
 * anything. Lines for a club year that has passed are left out; checkout checks everything else again.
 */
export const retryBasket = (order, currentYear) => {
  const groups = new Map();
  for (const item of order.items || []) {
    const lineId = item.sourceLineId || String(item.lineId || '').replace(NEXT_YEAR_LINE_SUFFIX, '');
    if (!lineId) continue;
    const group = groups.get(lineId) || { id: item.id, lineId, size: item.size || '', years: new Set(), clubYear: false };
    if (item.clubYear) { group.clubYear = true; group.years.add(item.clubYear); }
    groups.set(lineId, group);
  }
  const items = [];
  for (const group of groups.values()) {
    const clubYearChoice = group.clubYear ? choiceFor(group.years, currentYear) : null;
    if (group.clubYear && !clubYearChoice) continue;
    items.push({ id: group.id, lineId: group.lineId, ...(group.size ? { size: group.size } : {}), ...(clubYearChoice ? { clubYearChoice } : {}) });
  }
  const kept = new Set(items.map((item) => item.lineId));
  const sourceLines = (ids) => [...new Set((ids || []).map((id) => String(id).replace(NEXT_YEAR_LINE_SUFFIX, '')))].filter((id) => kept.has(id));
  const people = (order.people || []).map((person) => {
    const clean = sanitizePerson(person);
    return { ...clean, lineIds: sourceLines(person.lineIds), ownKitLineIds: sourceLines(person.ownKitLineIds) };
  }).filter((person) => person.lineIds.length);
  return { items, people };
};

/**
 * The basket that restarts a cancelled subscription: its items again, monthly, for the people who had them. Returns
 * null when its club year is no longer on sale. `describe(member)` adds fields to each person.
 */
export const restartBasket = (record, members, currentYear, makeId, now = new Date(), describe = () => ({})) => {
  const clubYearChoice = choiceFor(new Set([record.clubYear]), currentYear);
  if (!clubYearChoice) return null;
  const byId = new Map(members.map((member) => [member.id, member]));
  const people = new Map();
  const items = [];
  for (const item of record.items || []) {
    const holders = (item.membershipIds || []).filter((id) => byId.has(id));
    if (!item.productId || !holders.length) continue;
    const lineId = makeId();
    items.push({ id: item.productId, lineId, clubYearChoice });
    for (const id of holders) {
      if (!people.has(id)) {
        const member = byId.get(id);
        people.set(id, { id: makeId(), returning: true, firstName: member.firstName || '', lastName: member.lastName || '', dob: member.dob || '',
          junior: (ageOn(member.dob, now) ?? 18) < 18, ...describe(member), lineIds: [] });
      }
      people.get(id).lineIds.push(lineId);
    }
  }
  return { clubYearChoice, items, people: [...people.values()] };
};

/** The member's email for a failed monthly debit; `final` when Stripe has stopped retrying. */
export const invoiceFailureEmail = ({ names = [], itemNames = [], amountDuePence = 0, attempt = 1, nextAttempt = null, paidUntil = 0, restartUrl = '', cancelUrl = '', contact }) => {
  const who = listText(names);
  const what = listText(itemNames) || 'your Forth Canoe Club monthly payments';
  const intro = `Your monthly direct debit of ${money(amountDuePence)} for ${what}${who ? ` (${who})` : ''} did not go through.`;
  if (nextAttempt) {
    return {
      subject: 'Your Forth Canoe Club monthly payment did not go through',
      body: [intro, '',
        `Stripe, our payment provider, will try again on ${dateLabel(nextAttempt)}. You do not need to do anything if there is money in the account by then.`, '',
        `If your bank details have changed or you want to stop, contact ${contact}.`, '',
        `(Attempt ${attempt}.)`].join('\n')
    };
  }
  return {
    subject: 'Your Forth Canoe Club monthly payments have stopped',
    body: [intro, '',
      'Stripe, our payment provider, has tried again and will not try any more, so your monthly payments have stopped.',
      ...(paidUntil ? [`What they paid for runs until ${dateLabel(paidUntil)} and then ends.`] : []), '',
      `To restart your monthly payments, open this link and check out again (any missed months are not charged): ${restartUrl}`, '',
      `If you do not want to continue, confirm here so the club knows: ${cancelUrl}`, '',
      `Questions: ${contact}.`].join('\n')
  };
};

/** The days a paid monthly invoice covers, in seconds: the earliest line start to the latest line end. */
export const invoiceCoverage = (invoice) => {
  const periods = (invoice?.lines?.data || []).map((line) => line.period).filter((period) => period?.start > 0 && period?.end > period.start);
  return periods.length ? { start: Math.min(...periods.map((period) => period.start)), end: Math.max(...periods.map((period) => period.end)) } : null;
};

/**
 * Item names from a Stripe invoice's own line descriptions ("1 × Gold Subscription (at £30.00 / month)" gives "Gold
 * Subscription"), for subscriptions set up outside this site. Proration lines are only used when there is nothing else.
 */
export const invoiceItemNames = (invoice) => {
  const lines = (invoice?.lines?.data || []).filter((line) => String(line?.description || '').trim());
  const regular = lines.filter((line) => !line.proration);
  return [...new Set((regular.length ? regular : lines)
    .map((line) => line.description.trim().replace(/^\d+\s*[×x]\s*/, '').replace(/\s*\(at [^)]*\)$/, '').trim()).filter(Boolean))];
};

/**
 * The club receipt for a monthly payment Stripe collected. `recovered` when an earlier attempt at the same invoice
 * failed and the member was told so. `coverage.end` is exclusive, so the last day shown is the day before.
 */
export const monthlyReceiptEmail = ({ names = [], itemNames = [], amountPaidPence = 0, paidAt = 0, coverage = null, invoiceNumber = '', recovered = false, contact }) => {
  const who = listText(names);
  const what = listText(itemNames) || 'your Forth Canoe Club monthly payments';
  return {
    subject: `Forth Canoe Club receipt: monthly payment of ${money(amountPaidPence)}`,
    body: [recovered
      ? `Your monthly payment of ${money(amountPaidPence)} for ${what}${who ? ` (${who})` : ''} has now gone through, so there is nothing more to do.`
      : `Thank you. Your monthly payment of ${money(amountPaidPence)} for ${what}${who ? ` (${who})` : ''} has been paid.`, '',
    ...(paidAt ? [`Paid: ${dateLabel(paidAt)}`] : []),
    ...(coverage ? [`Covers: ${dateLabel(coverage.start)} to ${dateLabel(coverage.end - 1)}`] : []),
    ...(invoiceNumber ? [`Invoice: ${invoiceNumber}`] : []), '',
    `Questions about your monthly payments: ${contact}.`].join('\n')
  };
};

/** The member's email when a subscription ended early without a final failed-debit email (e.g. cancelled in Stripe). */
export const subscriptionStoppedEmail = ({ names = [], itemNames = [], paidUntil = 0, restartUrl = '', cancelUrl = '', contact }) => {
  const who = listText(names);
  const what = listText(itemNames) || 'your Forth Canoe Club monthly payments';
  return {
    subject: 'Your Forth Canoe Club monthly payments have stopped',
    body: [`Your monthly payments for ${what}${who ? ` (${who})` : ''} have stopped.`,
      ...(paidUntil ? [`What they paid for runs until ${dateLabel(paidUntil)} and then ends.`] : []), '',
      `To restart your monthly payments, open this link and check out again: ${restartUrl}`, '',
      `If you do not want to continue, confirm here so the club knows: ${cancelUrl}`, '',
      `Questions: ${contact}.`].join('\n')
  };
};

/** The treasurer's copy of a final failed debit. */
export const treasurerFailureEmail = ({ email, names = [], itemNames = [], amountDuePence = 0, attempt = 1, subscriptionId, invoiceId, paidUntil = 0 }) => ({
  subject: `Monthly payments stopped after failed debits - ${listText(names) || email}`,
  body: [`Stripe could not collect ${money(amountDuePence)} from ${email} after ${attempt} attempt${attempt === 1 ? '' : 's'} and has stopped retrying.`, '',
    `Items: ${listText(itemNames) || 'not recorded'}`, ...(names.length ? [`People: ${listText(names)}`] : []),
    ...(paidUntil ? [`Paid up to: ${dateLabel(paidUntil)}. The monthly items end then once Stripe cancels the subscription.`] : []),
    `Stripe subscription: ${subscriptionId}`, `Invoice: ${invoiceId}`, '',
    'The member has been emailed links to restart the payments or confirm they are stopping. It is listed under Reports & records → Needs attention.'].join('\n')
});

/** The customer's email when a one-off bank payment did not clear. */
export const orderFailureEmail = ({ orderRef, itemNames = [], retryUrl, cancelUrl, retryDays, contact }) => ({
  subject: `Your Forth Canoe Club payment did not go through - ${orderRef}`,
  body: [`Your payment for ${listText(itemNames) || 'your order'} (order ${orderRef}) did not clear, so nothing has been taken and the order has not gone through.`, '',
    `Retry payment: ${retryUrl}`,
    'This fills your basket with the same items and details. Check your bank details, then pay again. Availability, any discount code and the price are checked again.', '',
    `Cancel order: ${cancelUrl}`, '',
    `These links work for ${retryDays} days. For help, contact ${contact}.`].join('\n')
});
