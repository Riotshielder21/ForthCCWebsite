import { clubYearOf } from './clubYear.js';

export const VOLUNTEER_TIERS = ['20', '40', '60'];
export const VOLUNTEER_SPECIAL = '60+ hours: ask the club about 25% off CVC or camping paid for at our Tully weekend trip.';
export const DEFAULT_VOLUNTEER_BENEFITS = [
  { id: '20', hours: 20, monthlyDiscount: 5, monthlyCap: null, freeProductIds: ['keyhire'] },
  { id: '40', hours: 40, monthlyDiscount: 0, monthlyCap: 10, freeProductIds: ['boat-hire', 'keyhire'] },
  { id: '60', hours: 60, monthlyDiscount: 0, monthlyCap: 0, freeProductIds: ['boat-hire', 'keyhire'] }
];

export const volunteerBenefitText = (tier, products = []) => {
  const names = tier.freeProductIds.map((id) => products.find((product) => product.id === id)?.name || id);
  return [
    tier.monthlyCap !== null ? (tier.monthlyCap === 0 ? 'Free Blue and Gold subscriptions' : `Blue and Gold subscriptions at up to £${tier.monthlyCap}/month`)
      : `£${tier.monthlyDiscount}/month off Blue and Gold subscriptions`,
    ...names.map((name) => `Free ${name}`),
    ...(tier.id === '60' ? [VOLUNTEER_SPECIAL] : [])
  ].join('. ');
};

export const validateVolunteerBenefits = (body) => {
  if (!Array.isArray(body?.tiers) || body.tiers.length !== 3) return { error: 'Supply the 20+, 40+ and 60+ hour brackets.' };
  const tiers = [];
  for (const id of VOLUNTEER_TIERS) {
    const tier = body.tiers.find((candidate) => candidate?.id === id);
    if (!tier || tier.hours !== Number(id) || !Number.isFinite(tier.monthlyDiscount) || tier.monthlyDiscount < 0 || tier.monthlyDiscount > 1000
      || !(tier.monthlyCap === null || (Number.isFinite(tier.monthlyCap) && tier.monthlyCap >= 0 && tier.monthlyCap <= 1000))
      || !Array.isArray(tier.freeProductIds) || tier.freeProductIds.length > 50
      || tier.freeProductIds.some((value) => typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))) {
      return { error: 'Check the bracket discounts and free products.' };
    }
    tiers.push({ id, hours: Number(id), monthlyDiscount: tier.monthlyDiscount, monthlyCap: tier.monthlyCap, freeProductIds: [...new Set(tier.freeProductIds)] });
  }
  return { value: tiers };
};

export const volunteerYear = (member, year = clubYearOf()) => member?.volunteer?.inducted === true
  && member.volunteer.years?.[year]?.active === true ? member.volunteer.years[year] : null;

export const needsVolunteerRenewal = (member, year) => Boolean(volunteerYear(member, year - 1) && !volunteerYear(member, year));

export const volunteerPrivileges = (member, tiers, now = new Date()) => {
  const year = clubYearOf(now);
  const active = volunteerYear(member, year);
  const tier = active && tiers.find((candidate) => candidate.id === active.tier);
  return tier ? tier.freeProductIds.map((id) => ({ productId: id, clubYear: year, source: 'volunteer' })) : [];
};

export const volunteerProfileLabels = (member, now = new Date()) => {
  if (!member?.volunteer?.inducted) return [];
  const year = volunteerYear(member, clubYearOf(now));
  return ['Inducted volunteer', ...(year ? [`Active volunteer (${year.tier}+ hours)`, ...(year.benefits || [])] : [])];
};

/** Only server-matched membership records may supply entitlements; request-body flags are never trusted. */
export const applyVolunteerBenefits = (lines, people, members, tiers, now = new Date()) => lines.map((line) => {
  const holders = people.filter((person) => person.lineIds.includes(line.lineId));
  if (!holders.length) return line;
  const year = clubYearOf(now) + (line.clubYearPart === 'next' ? 1 : 0);
  const prices = holders.map((person) => {
    const active = volunteerYear(members.get(person.membershipId), year);
    const tier = active && tiers.find((candidate) => candidate.id === active.tier);
    if (!tier) return line.basePrice;
    if (tier.freeProductIds.includes(line.id)) return 0;
    if (!['blue-sub', 'gold-sub'].includes(line.id)) return line.basePrice;
    return tier.monthlyCap === null ? Math.max(0, line.basePrice - tier.monthlyDiscount) : Math.min(line.basePrice, tier.monthlyCap);
  });
  // A shared line receives only the benefit all its holders qualify for.
  const price = Math.max(...prices);
  return price < line.basePrice ? { ...line, basePrice: price, volunteerOriginalPrice: line.basePrice, volunteerBenefit: true } : line;
});
