import { clubYearDates, clubYearKind, clubYearOf, londonMidnight, recordClubYear, subscriptionCoversYear } from './clubYear.js';

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
/** Renewal links for a club year stop working at the end of 31 March, a month after the old year ends. */
export const renewalLinkExpiresAt = (renewalYear) => londonMidnight(renewalYear, 3, 1);

export const renewalWindow = (now = new Date()) => {
  const clubYear = clubYearOf(now);
  const dates = clubYearDates(clubYear);
  return { clubYear, renewalYear: clubYear + 1, opens: dates.renewalOpens, scheduledFrom: londonMidnight(clubYear + 1, 1, 1),
    reminderFrom: londonMidnight(clubYear + 1, 1, 15),
    closes: dates.end, expiresAt: renewalLinkExpiresAt(clubYear + 1) };
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
 * services they hold this club year that are still sold, all for the renewal year. Subscriptions are left out: they
 * carry on by themselves, and the payer is asked about them in their own renewal email (`subscriptionsContinue` says whether
 * anyone in the basket has one). Line ids come from `makeId`.
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
  let subscriptionsContinue = false;
  people.forEach((person, index) => {
    const { entitlements = [], subscriptionItems = [] } = members[index];
    if (subscriptionItems.some((item) => subscriptionCoversYear(item, clubYear + 1))) subscriptionsContinue = true;
    const held = entitlements.filter((item) => !item.endedAt && recordClubYear(item) === clubYear).map((item) => item.productId);
    for (const productId of new Set(held)) {
      const product = catalog.find((candidate) => candidate.id === productId);
      const kind = product && clubYearKind(product);
      if (!kind || kind === 'membership' || kind === 'monthly' || product.type === 'external') continue;
      addLine(product, [person]);
    }
  });
  return { people, items, billingMode: 'annual', subscriptionsContinue };
};

/** The club-year choice a renewal line takes when the link is opened: next year until 1 March, then this year. */
export const renewalChoice = (renewalYear, now = new Date()) => renewalYear === clubYearOf(now) ? 'this' : renewalYear === clubYearOf(now) + 1 ? 'next' : null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

const GREEN = '#15803d';
const RED = '#b91c1c';
const dayLabel = (date) => date.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
const emailButton = (href, label, colour) => `<td style="border-radius:8px;background:${colour}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-weight:bold;font-size:16px;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td>`;
const buttonRow = (button) => `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 16px"><tr>${button}</tr></table>`;
// Smaller buttons sit side by side, wrapping on a narrow screen.
const smallButton = (href, label) => `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 14px;border-radius:6px;background:${GREEN};color:#ffffff;font-weight:bold;font-size:14px;text-decoration:none">${escapeHtml(label)}</a>`;
const joinNames = (names) => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';

/** A subscription line's price from 1 March, with the volunteer price when its holders could volunteer again. */
export const subscriptionLineText = (line) => `${line.name}${line.names?.length ? ` (${line.names.join(', ')})` : ''}: ${line.ifVolunteering
  ? `${line.ifVolunteering} if ${joinNames(line.volunteers || [])} ${(line.volunteers || []).length > 1 ? 'volunteer' : 'volunteers'} again, otherwise ${line.nextPrice}`
  : line.nextPrice}`;

/**
 * The renewal email for one contact address. It lists everything for the new club year: the basket of next year's
 * membership and services (`basket`), each volunteer who could sign up again (`volunteers`), and each subscription the
 * address pays for, at its price from 1 March (`subscriptions`). Confirm all (`confirmAllUrl`) comes first: it confirms
 * the volunteering and subscriptions, then opens the basket. A row of smaller buttons confirms each part on its own,
 * and the red Cancel at the bottom stops a subscription at the end of February. Parts that do not apply are left out,
 * so a payer with nothing to renew is asked only about their subscriptions. Every button opens a page where the member
 * confirms, so a mail scanner following links changes nothing. The wording is a template until the club agrees the
 * final text (issue #43).
 */
export const renewalEmail = ({ renewalYear, reminder = false, contact = '', basket = null, volunteers = [], subscriptions = [], confirmAllUrl = '' }) => {
  const year = `${renewalYear}/${String((renewalYear + 1) % 100).padStart(2, '0')}`;
  const subject = basket ? `${reminder ? 'Reminder: renew' : 'Renew'} your Forth Canoe Club membership for ${year}`
    : `${reminder ? 'Reminder: confirm' : 'Confirm'} or cancel your Forth Canoe Club subscription for ${year}`;
  const text = [];
  const html = [];
  const paragraph = (value) => { text.push(value); html.push(`<p>${escapeHtml(value)}</p>`); };
  const heading = (title) => { text.push('', title.toUpperCase()); html.push(`<h3 style="margin:20px 0 4px;font-size:16px">${escapeHtml(title)}</h3>`); };
  const list = (values) => { text.push(...values.map((value) => `- ${value}`)); html.push(`<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`); };
  const button = (label, href, colour = GREEN) => { text.push(`${label}: ${href}`); html.push(buttonRow(emailButton(href, label, colour))); };
  const named = (part, verb) => subscriptions.length > 1 ? `${verb} ${joinNames(part.lines.map((line) => line.name))}` : `${verb} subscription`;
  const confirms = [
    ...(basket ? [{ label: 'Confirm membership and services', alone: 'Confirm: go to the basket', url: basket.link }] : []),
    ...volunteers.map((entry) => ({ label: `Confirm volunteering for ${entry.firstName || entry.name}`, url: entry.keepUrl })),
    ...subscriptions.map((part) => ({ label: named(part, 'Confirm'), url: part.confirmUrl }))
  ];
  const together = Boolean(confirmAllUrl) && confirms.length > 1;
  paragraph(`Club year ${year} starts on 1 March. ${together ? 'Here is everything for it: confirm it all at once, or each part on its own below.' : 'Here are the details.'}`);

  if (basket) {
    const { people, items, catalog } = basket;
    const names = people.map((person) => [person.firstName, person.lastName].filter(Boolean).join(' ')).filter(Boolean);
    heading('Membership and services');
    paragraph(`Renew ${names.join(', ') || 'your membership'}: the link fills your basket with:`);
    list(items.map((item) => {
      const holders = people.filter((person) => person.lineIds.includes(item.lineId)).map((person) => person.firstName).filter(Boolean);
      return `${catalog.find((product) => product.id === item.id)?.name || item.id}${holders.length ? ` (${holders.join(', ')})` : ''}`;
    }));
  }
  if (volunteers.length) {
    heading('Volunteering');
    list(volunteers.map((entry) => `${entry.name}: you have not signed up to volunteer next club year. Keep your ${entry.commitment} commitment, or choose different hours.`));
  }
  if (subscriptions.length) {
    heading(subscriptions.length > 1 ? 'Subscriptions' : 'Subscription');
    paragraph(`${subscriptions.length > 1 ? 'These carry' : 'This carries'} on into club year ${year} unless you cancel. From 1 March, at the new club year's price:`);
    list(subscriptions.flatMap((part) => part.lines.map(subscriptionLineText)));
  }

  text.push('');
  if (together) {
    button(basket ? 'Confirm all and go to the basket' : 'Confirm all', confirmAllUrl);
    paragraph(`This confirms ${[volunteers.length && 'the volunteering', subscriptions.length && `the ${subscriptions.length > 1 ? 'subscriptions' : 'subscription'}`].filter(Boolean).join(' and ')}${basket ? ', then opens your basket to pay for the membership and services' : ''}.`);
    paragraph('Or confirm each part on its own:');
    text.push(...confirms.map((entry) => `${entry.label}: ${entry.url}`));
    html.push(`<p style="margin:4px 0 12px">${confirms.map((entry) => smallButton(entry.url, entry.label)).join('')}</p>`);
  } else if (confirms.length) {
    for (const entry of confirms) button(entry.alone || entry.label, entry.url);
  }

  if (basket) {
    paragraph(`Remove anything you no longer want from the basket, or add more, before paying. Nothing is charged until you check out. The basket link works until ${dayLabel(new Date(basket.expiresAt.getTime() - 1))}. Renewing through JustGo instead? Ignore the basket.`
      + (basket.subscriptionsContinue && !subscriptions.length ? ' Subscriptions are not in the basket: they carry on by themselves, and whoever pays for them is asked about them.' : ''));
  }
  for (const entry of volunteers) {
    text.push(`Choose different hours for ${entry.firstName || entry.name}: ${entry.changeUrl}`);
    html.push(`<p><a href="${escapeHtml(entry.changeUrl)}">Choose different volunteering hours for ${escapeHtml(entry.firstName || entry.name)}</a></p>`);
  }
  if (subscriptions.length) {
    paragraph('On 1 March every subscription moves to the new club year\'s price, and a discount code covered only the year it was used in.'
      + (subscriptions.some((part) => part.lines.some((line) => line.ifVolunteering)) ? ' The volunteer price applies once volunteering is confirmed for next club year.' : ''));
    heading(`Cancel ${subscriptions.length > 1 ? 'a subscription' : 'your subscription'}`);
    paragraph(`Cancelling stops the payments from 1 March; payments already taken are not refunded. If you do not answer, it carries on. You can change your answer until ${dayLabel(new Date(clubYearDates(renewalYear).start.getTime() - 1))}.`);
    for (const part of subscriptions) button(named(part, 'Cancel'), part.cancelUrl, RED);
  }
  if (contact) paragraph(`Questions: ${contact}.`);
  text.push('', 'Forth Canoe Club');
  return { subject, body: text.join('\n'),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="font-family:ui-sans-serif,system-ui,Arial,sans-serif;color:#002147;font-size:14px;line-height:1.6">\n${html.join('\n')}\n<p>Forth Canoe Club</p></body></html>` };
};
