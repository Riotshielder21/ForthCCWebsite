export const MAX_VOLUNTEER_OPPORTUNITIES = 50;
export const VOLUNTEER_PAGE_TEXT_LIMITS = { title: 200, intro: 2000, waysTitle: 200, formTitle: 200, formDescription: 2000 };

export const DEFAULT_VOLUNTEER_PAGE = {
  title: 'Volunteering',
  intro: 'Forth Canoe Club runs on volunteers. Every contribution — from coaching and events to maintenance and fundraising — makes a real difference. We reward volunteer commitment with substantial discounts on memberships and activities.',
  waysTitle: 'Ways to Volunteer',
  opportunities: [
    { title: 'Canal Festival', description: 'The most important community event of the year' },
    { title: 'Maintenance', description: 'Painting, cleaning, weeding, and building at the clubhouse' },
    { title: 'Coaching', description: 'Shadowing coaches, helping at pool and summer sessions, running beginner classes' },
    { title: 'Key Holding', description: 'Open the club for club nights and open nights' },
    { title: 'Equipment Repair', description: 'Plastic welding, carbon repairs, wooden canoe seats, airbag fixes' },
    { title: 'Fundraising', description: 'Grant applications, baking stalls, community events' },
    { title: 'Access Project', description: 'Join our subcommittee working on accessibility improvements' }
  ],
  formTitle: 'Get Involved',
  formDescription: 'Choose your hours for the club year. Your benefits are added to your membership once you are inducted.'
};

// Only migrate wording: old tile layouts and arbitrary custom tiles are deliberately not carried over.
export const volunteerPageFromLegacy = (copy = {}) => ({
  ...Object.fromEntries(Object.keys(VOLUNTEER_PAGE_TEXT_LIMITS).map((key) => [key, copy[key] ?? DEFAULT_VOLUNTEER_PAGE[key]])),
  opportunities: typeof copy.waysList === 'string' ? copy.waysList.split('\n').map((line) => {
    const [title, ...description] = line.split('|').map((part) => part.trim());
    return { title, description: description.join(' | ') };
  }).filter((item) => item.title) : DEFAULT_VOLUNTEER_PAGE.opportunities
});

export const validateVolunteerPage = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !Object.hasOwn(VOLUNTEER_PAGE_TEXT_LIMITS, key) && key !== 'opportunities')) {
    return { error: 'Only volunteering wording and the ways to volunteer list can be configured.' };
  }
  const value = {};
  for (const [key, limit] of Object.entries(VOLUNTEER_PAGE_TEXT_LIMITS)) {
    if (typeof body[key] !== 'string' || body[key].length > limit || (/Title$|^title$/.test(key) && !body[key].trim())) {
      return { error: `Check ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} (maximum ${limit} characters).` };
    }
    value[key] = body[key].trim();
  }
  if (!Array.isArray(body.opportunities) || body.opportunities.length > MAX_VOLUNTEER_OPPORTUNITIES) {
    return { error: `Keep no more than ${MAX_VOLUNTEER_OPPORTUNITIES} ways to volunteer.` };
  }
  value.opportunities = [];
  for (const item of body.opportunities) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some((key) => !['title', 'description'].includes(key))
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
      || typeof item.description !== 'string' || item.description.length > 1000) {
      return { error: 'Each way to volunteer needs a title (up to 200 characters) and a description (up to 1000 characters).' };
    }
    value.opportunities.push({ title: item.title.trim(), description: item.description.trim() });
  }
  return { value };
};
