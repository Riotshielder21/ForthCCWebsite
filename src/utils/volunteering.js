import { clubYearOf } from './clubYear.js';

export const VOLUNTEER_LEVEL_ID = /^[a-z0-9-]{1,40}$/;
export const MAX_VOLUNTEER_LEVELS = 10;
const LEVEL_TEXT_LIMITS = { title: 80, description: 1000, extra: 500 };
export const DEFAULT_VOLUNTEER_BENEFITS = [
  { id: '20', hours: 20, title: 'Get Started', description: '', extra: '', monthlyDiscount: 5, monthlyCap: null, freeProductIds: ['keyhire'] },
  { id: '40', hours: 40, title: 'Regular Volunteer', description: '', extra: '', monthlyDiscount: 0, monthlyCap: 10, freeProductIds: ['boat-hire', 'keyhire'] },
  { id: '60', hours: 60, title: 'Core Team', description: '', extra: 'Ask the club about 25% off CVC or camping paid for at our Tully weekend trip.',
    monthlyDiscount: 0, monthlyCap: 0, freeProductIds: ['boat-hire', 'keyhire'] }
];

/** Levels saved before titles and extras existed take those from the matching default level. */
export const normaliseVolunteerLevels = (levels) => (Array.isArray(levels) && levels.length ? levels : DEFAULT_VOLUNTEER_BENEFITS)
  .map((level) => {
    const fallback = DEFAULT_VOLUNTEER_BENEFITS.find((candidate) => candidate.id === level.id);
    return { ...level, title: level.title ?? fallback?.title ?? '', description: level.description ?? '', extra: level.extra ?? fallback?.extra ?? '' };
  })
  .sort((a, b) => a.hours - b.hours);

export const volunteerLevelLabel = (levels, id) => {
  const level = levels?.find((candidate) => candidate.id === id);
  if (level) return `${level.hours}+ hours`;
  return /^\d+$/.test(id || '') ? `${id}+ hours` : 'volunteer level';
};

export const volunteerBenefitText = (tier, products = []) => {
  const names = tier.freeProductIds.map((id) => products.find((product) => product.id === id)?.name || id);
  return [
    ...(tier.monthlyCap !== null ? [tier.monthlyCap === 0 ? 'Free Blue and Gold subscriptions' : `Blue and Gold subscriptions at up to £${tier.monthlyCap}/month`]
      : tier.monthlyDiscount > 0 ? [`£${tier.monthlyDiscount}/month off Blue and Gold subscriptions`] : []),
    ...names.map((name) => `Free ${name}`),
    ...(tier.extra ? [tier.extra.replace(/\.$/, '')] : [])
  ].join('. ');
};

export const validateVolunteerBenefits = (body) => {
  if (!Array.isArray(body?.tiers) || !body.tiers.length || body.tiers.length > MAX_VOLUNTEER_LEVELS) {
    return { error: `Keep between 1 and ${MAX_VOLUNTEER_LEVELS} volunteer levels.` };
  }
  const tiers = [];
  for (const tier of body.tiers) {
    if (!tier || typeof tier !== 'object' || typeof tier.id !== 'string' || !VOLUNTEER_LEVEL_ID.test(tier.id) || tiers.some((other) => other.id === tier.id)) {
      return { error: 'Each volunteer level needs its own identity.' };
    }
    if (!Number.isInteger(tier.hours) || tier.hours < 1 || tier.hours > 2000 || tiers.some((other) => other.hours === tier.hours)) {
      return { error: 'Give each volunteer level a different number of hours (1 to 2000).' };
    }
    if (!Number.isFinite(tier.monthlyDiscount) || tier.monthlyDiscount < 0 || tier.monthlyDiscount > 1000
      || !(tier.monthlyCap === null || (Number.isFinite(tier.monthlyCap) && tier.monthlyCap >= 0 && tier.monthlyCap <= 1000))
      || !Array.isArray(tier.freeProductIds) || tier.freeProductIds.length > 50
      || tier.freeProductIds.some((value) => typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))) {
      return { error: 'Check the level discounts and free services.' };
    }
    const text = {};
    for (const [key, limit] of Object.entries(LEVEL_TEXT_LIMITS)) {
      const value = tier[key] ?? '';
      if (typeof value !== 'string' || value.trim().length > limit) return { error: `Keep the level ${key === 'extra' ? 'other benefits' : key} under ${limit} characters.` };
      text[key] = value.trim();
    }
    if (!text.title) return { error: 'Give each volunteer level a title.' };
    tiers.push({ id: tier.id, hours: tier.hours, ...text, monthlyDiscount: tier.monthlyDiscount, monthlyCap: tier.monthlyCap, freeProductIds: [...new Set(tier.freeProductIds)] });
  }
  return { value: tiers.sort((a, b) => a.hours - b.hours) };
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
  const label = Number.isInteger(year?.hours) ? `${year.hours}+ hours` : volunteerLevelLabel([], year?.tier);
  return ['Inducted volunteer', ...(year ? [`Active volunteer (${label})`, ...(year.benefits || [])] : [])];
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
