import { DISCOUNTS } from '../constants/products.js';
import { clubYearDates, clubYearLabel, clubYearOf, londonMidnight } from './clubYear.js';
import { activeSubscriptionItems } from './subscriptions.js';
import { volunteerPriceFor } from './volunteerAdjustments.js';
import { needsVolunteerRenewal, volunteerYear } from './volunteering.js';

const millis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Number(value) || 0);
const twoPlaces = (value) => Math.round(value * 100) / 100;

/**
 * Subscriptions carry on from one club year to the next. With the renewal emails (from 1 January), whoever pays for one
 * is asked whether it carries on into `renewalYear`: Confirm keeps it, Cancel stops it at the end of February (after the
 * 1 February debit; no 1 March yearly payment). Not answering leaves it carrying on. Answers can change until 1 March.
 */
export const continuationOpen = (renewalYear, now = new Date()) =>
  now >= clubYearDates(renewalYear - 1).renewalOpens && now < clubYearDates(renewalYear).start;

/**
 * Who is asked: active website subscriptions that still have something on them, are not already set to end, and
 * started before the renewal window opened. Anyone who subscribed since, or for the renewal year itself, has just
 * agreed to it carrying on.
 */
export const needsContinuation = (subscription, renewalYear) => Boolean(subscription?.status === 'active' && subscription.email
  && !millis(subscription.cancelAt) && activeSubscriptionItems(subscription).length
  && !(Number.isInteger(subscription.clubYear) && subscription.clubYear >= renewalYear)
  && millis(subscription.createdAt) < clubYearDates(renewalYear - 1).renewalOpens.getTime());

/** The answer recorded for `renewalYear`: 'confirmed', 'cancelled', or 'unconfirmed' when there is none yet. */
export const continuationAnswer = (subscription, renewalYear) => {
  const recorded = subscription?.continuation;
  return recorded?.renewalYear === renewalYear && ['confirmed', 'cancelled'].includes(recorded.status) ? recorded.status : 'unconfirmed';
};

/** What the member is told once they have answered. */
export const continuationResult = (status, renewalYear) => status === 'cancelled'
  ? `Cancelled. Your subscription stops at the end of February and nothing is taken from 1 March ${renewalYear}.`
  : status === 'confirmed' ? `Confirmed. Your subscription carries on into club year ${clubYearLabel(renewalYear)}.`
    : `Your subscription carries on into club year ${clubYearLabel(renewalYear)} unless you cancel it.`;

/**
 * What a continuing subscription item costs from 1 March of `renewalYear`, when every subscription moves to the new
 * club year's prices: the shop price for that year (`nextYearPrice` or `basePrice` a month, from the catalogue priced at
 * `now`; a yearly item is twelve months, less the annual discount when
 * the product has one), or the volunteer price when every holder volunteers that year. A discount code covered only the
 * year it was used in. When holders volunteered this year but have not signed up again, `ifVolunteering` is the price if
 * they do with the same hours, when that is lower, and `volunteers` names them. An item bought for the renewal year or
 * later keeps its price.
 */
export const renewalPrice = ({ item, product, members = new Map(), tiers = [], renewalYear, now = new Date() }) => {
  const yearly = item.interval === 'year';
  if ((Number(item.clubYear) || 0) >= renewalYear) return { price: Number(yearly ? item.yearlyAmount : item.monthlyAmount) || 0 };
  const perPayment = (monthly) => twoPlaces(yearly ? monthly * 12 * (product.hasAnnualDiscount ? 1 - DISCOUNTS.ANNUAL : 1) : monthly);
  // `product` is priced at `now` (see yearPrices): next club year's price is set apart until it starts.
  const basePrice = Number(renewalYear > clubYearOf(now) ? product.nextYearPrice ?? product.basePrice : product.basePrice) || 0;
  const monthlyFor = (people) => volunteerPriceFor({ productId: item.productId, basePrice, membershipIds: item.membershipIds, clubYear: renewalYear,
    members: people, tiers, now }) ?? basePrice;
  const price = perPayment(monthlyFor(members));
  const lapsing = (item.membershipIds || []).map((id) => members.get(id)).filter((member) => needsVolunteerRenewal(member, renewalYear));
  if (!lapsing.length) return { price };
  const renewed = new Map([...members].map(([id, member]) => [id, needsVolunteerRenewal(member, renewalYear)
    ? { ...member, volunteer: { ...member.volunteer, years: { ...member.volunteer.years, [renewalYear]: volunteerYear(member, renewalYear - 1) } } } : member]));
  const ifVolunteering = perPayment(monthlyFor(renewed));
  return ifVolunteering < price ? { price, ifVolunteering, volunteers: lapsing.map((member) => member.firstName || 'they') } : { price };
};

/** The club year whose prices subscriptions are charged next: the coming one from 2 February, once February's monthly payment is taken. */
export const pricingYear = (now = new Date()) => clubYearOf(now) + (now >= londonMidnight(clubYearOf(now) + 1, 1, 2) ? 1 : 0);
