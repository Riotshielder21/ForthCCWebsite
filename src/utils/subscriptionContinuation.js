import { clubYearDates, clubYearLabel } from './clubYear.js';
import { activeSubscriptionItems } from './subscriptions.js';

const millis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Number(value) || 0);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const dayLabel = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

/**
 * Subscriptions carry on from one club year to the next. With the renewal emails (from 1 January), whoever pays for one
 * is asked whether it carries on into `renewalYear`: Confirm keeps it, Cancel stops it at the end of February (after the
 * 1 February debit; no 1 March yearly payment). Not answering leaves it carrying on. Answers can change until 1 March.
 */
export const continuationOpen = (renewalYear, now = new Date()) =>
  now >= clubYearDates(renewalYear - 1).renewalOpens && now < clubYearDates(renewalYear).start;

/**
 * Who is asked: active website subscriptions that still have something on them, are not already set to end, and
 * started before the renewal window opened. Anyone who subscribed since has just agreed to it carrying on.
 */
export const needsContinuation = (subscription, renewalYear) => Boolean(subscription?.status === 'active' && subscription.email
  && !millis(subscription.cancelAt) && activeSubscriptionItems(subscription).length
  && millis(subscription.createdAt) < clubYearDates(renewalYear - 1).renewalOpens.getTime());

/** The answer recorded for `renewalYear`: 'confirmed', 'cancelled', or 'unconfirmed' when there is none yet. */
export const continuationAnswer = (subscription, renewalYear) => {
  const recorded = subscription?.continuation;
  return recorded?.renewalYear === renewalYear && ['confirmed', 'cancelled'].includes(recorded.status) ? recorded.status : 'unconfirmed';
};

const button = (href, label, colour) => `<td style="border-radius:8px;background:${colour}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-weight:bold;font-size:16px;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td>`;

/** The continue/cancel email for one subscription, with its items, a green Confirm and a red Cancel button. */
export const continuationEmail = ({ renewalYear, lines, confirmUrl, cancelUrl, reminder = false, contact }) => {
  const year = clubYearLabel(renewalYear);
  const lastDay = dayLabel(new Date(clubYearDates(renewalYear).start.getTime() - 1));
  const subject = `${reminder ? 'Reminder: confirm' : 'Confirm'} or cancel your Forth Canoe Club subscription for ${year}`;
  const intro = `Your subscription carries on into club year ${year}, which starts on 1 March:`;
  const items = lines.map((line) => `${line.name}${line.names?.length ? ` (${line.names.join(', ')})` : ''}: ${line.price}`);
  const choices = `Confirm to keep it, or cancel to stop it at the end of February. Cancelling stops the payments from 1 March; the payments already taken are not refunded. If you do not answer, it carries on as now. You can change your answer until ${lastDay}.`;
  const help = `Questions: ${contact}.`;
  const body = [intro, '', ...items.map((item) => `- ${item}`), '', choices, '', `Confirm: ${confirmUrl}`, `Cancel: ${cancelUrl}`, '', help, '', 'Forth Canoe Club'].join('\n');
  const html = `<!doctype html><html lang="en"><body style="font-family:ui-sans-serif,system-ui,Arial,sans-serif;color:#002147;font-size:14px;line-height:1.6">
<p>${escapeHtml(intro)}</p><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
<p>${escapeHtml(choices)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>${button(confirmUrl, 'Confirm', '#15803d')}<td style="width:16px"></td>${button(cancelUrl, 'Cancel', '#b91c1c')}</tr></table>
<p>${escapeHtml(help)}</p><p>Forth Canoe Club</p></body></html>`;
  return { subject, body, html };
};

/** What the member is told once they have answered. */
export const continuationResult = (status, renewalYear) => status === 'cancelled'
  ? `Cancelled. Your subscription stops at the end of February and nothing is taken from 1 March ${renewalYear}.`
  : status === 'confirmed' ? `Confirmed. Your subscription carries on into club year ${clubYearLabel(renewalYear)}.`
    : `Your subscription carries on into club year ${clubYearLabel(renewalYear)} unless you cancel it.`;
