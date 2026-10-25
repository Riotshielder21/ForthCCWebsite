import { clubYearDates, clubYearKind, clubYearOf, londonMidnight, recordClubYear } from './clubYear.js';

const millis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : new Date(value).getTime() || 0;
};

/**
 * Renewal emails for next club year can be sent by staff from 1 January. They are sent automatically twice: on 1 February
 * to anyone not yet emailed, and a reminder on 15 February to anyone who still has not renewed. This club year ends on
 * 1 March. Links work until the end of 31 March so late renewals still prefill the basket.
 */
export const renewalWindow = (now = new Date()) => {
  const clubYear = clubYearOf(now);
  const dates = clubYearDates(clubYear);
  return { clubYear, renewalYear: clubYear + 1, opens: dates.renewalOpens, scheduledFrom: londonMidnight(clubYear + 1, 1, 1),
    reminderFrom: londonMidnight(clubYear + 1, 1, 15),
    closes: dates.end, expiresAt: londonMidnight(clubYear + 1, 3, 1) };
};

/** The scheduled round due at `now`: 'first' from 1 February, 'reminder' from 15 February, otherwise none. */
export const renewalRound = (now = new Date()) => {
  const window = renewalWindow(now);
  if (now < window.scheduledFrom || now >= window.closes) return null;
  return now < window.reminderFrom ? 'first' : 'reminder';
};

/**
 * Website members whose cover ends with this club year and who have not renewed (JustGo members renew there). Anyone
 * already holding next year's membership is never emailed, even if they chose not to renew this year's extras.
 */
export const needsRenewal = (member, now = new Date()) => {
  const clubYear = clubYearOf(now);
  const end = clubYearDates(clubYear).end.getTime();
  const validUntil = millis(member?.validUntil);
  return !(member?.membershipAccessEndsAt !== undefined && millis(member.membershipAccessEndsAt) <= now.getTime())
    && /^active$/i.test(String(member?.status || '')) && member.renewalMethod === 'website' && member.contactOnly !== true
    && validUntil > now.getTime() && validUntil <= end + 24 * 60 * 60 * 1000
    && !(member.clubYears || []).map(Number).includes(clubYear + 1);
};

const membershipProduct = (catalog, tier) => catalog.find((product) => product.category === 'MEMBERSHIP' && product.membershipTier === tier && product.type !== 'external');

/**
 * The basket a renewal link fills: each member's membership (one family membership shared by a family) and the
 * services and subscriptions they hold this club year that are still sold, all for the renewal year. Monthly billing
 * is chosen when they pay for something monthly now. Line ids come from `makeId`.
 */
export const renewalBasket = (unordered, catalog, clubYear, makeId) => {
  // Oldest first, so an adult is the first person and becomes the family contact at checkout.
  const members = [...unordered].sort((a, b) => (a.dob || '9999').localeCompare(b.dob || '9999'));
  const people = members.map((member) => ({ id: makeId(), membershipId: member.id, returning: true, firstName: member.firstName || '', lastName: member.lastName || '',
    dob: member.dob || '', lineIds: [] }));
  const items = [];
  const addLine = (product, holders) => {
    const lineId = makeId();
    items.push({ id: product.id, lineId });
    holders.forEach((person) => { person.lineIds.push(lineId); });
  };
  const family = membershipProduct(catalog, 'family');
  const familyHolders = family ? people.filter((_, index) => members[index].membershipTier === 'family') : [];
  if (familyHolders.length) addLine(family, familyHolders);
  people.forEach((person, index) => {
    if (familyHolders.includes(person)) return;
    const product = membershipProduct(catalog, members[index].membershipTier === 'junior' ? 'junior' : 'adult');
    if (product) addLine(product, [person]);
  });
  let monthly = false;
  people.forEach((person, index) => {
    const { privileges = [], subscriptionItems = [] } = members[index];
    const held = [
      ...privileges.filter((privilege) => !privilege.endedAt && recordClubYear(privilege) === clubYear).map((privilege) => privilege.productId),
      ...subscriptionItems.filter((item) => item.status === 'active' && recordClubYear(item) === clubYear).map((item) => item.productId)
    ];
    for (const productId of new Set(held)) {
      const product = catalog.find((candidate) => candidate.id === productId);
      const kind = product && clubYearKind(product);
      if (!kind || kind === 'membership' || product.type === 'external') continue;
      addLine(product, [person]);
      if (subscriptionItems.some((item) => item.productId === productId && item.status === 'active' && recordClubYear(item) === clubYear)) monthly = true;
    }
  });
  return { people, items, billingMode: monthly ? 'monthly' : 'annual' };
};

/** The club-year choice a renewal line takes when the link is opened: next year until 1 March, then this year. */
export const renewalChoice = (renewalYear, now = new Date()) => renewalYear === clubYearOf(now) ? 'this' : renewalYear === clubYearOf(now) + 1 ? 'next' : null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/**
 * The renewal email for one contact address: who is renewing, what the link puts in the basket, and when it expires.
 * The wording is a template until the club agrees the final text (see TODO.md).
 */
export const renewalEmail = ({ people, items, catalog, renewalYear, link, expiresAt, reminder = false, volunteering = { body: '', html: '' } }) => {
  const year = `${renewalYear}/${String((renewalYear + 1) % 100).padStart(2, '0')}`;
  const names = people.map((person) => [person.firstName, person.lastName].filter(Boolean).join(' ')).filter(Boolean);
  const lines = items.map((item) => {
    const holders = people.filter((person) => person.lineIds.includes(item.lineId)).map((person) => person.firstName).filter(Boolean);
    return `${catalog.find((product) => product.id === item.id)?.name || item.id}${holders.length ? ` (${holders.join(', ')})` : ''}`;
  });
  const expiry = new Date(expiresAt.getTime() - 1).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `${reminder ? 'Reminder: renew' : 'Renew'} your Forth Canoe Club membership for ${year}`;
  const intro = `Club year ${year} starts on 1 March. Renew ${names.join(', ') || 'your membership'} using the link below. It fills your basket with:`;
  const after = `Remove anything you no longer want, or add more, before paying. Nothing is charged until you check out. The link works until ${expiry}. Renewing through JustGo instead? Ignore this email.`;
  const body = `${intro}\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\n${link}\n\n${after}\n\n${volunteering.body}\n\nForth Canoe Club`;
  const html = `<!doctype html><html lang="en"><body style="font-family:ui-sans-serif,system-ui,Arial,sans-serif;color:#002147;font-size:14px;line-height:1.6">
<p>${escapeHtml(intro)}</p><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#002147;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold">Renew for ${escapeHtml(year)}</a></p>
<p>${escapeHtml(after)}</p>${volunteering.html}<p>Forth Canoe Club</p></body></html>`;
  return { subject, body, html };
};
