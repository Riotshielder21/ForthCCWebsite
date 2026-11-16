import { PUBLIC_ROUTES } from './routes.js';

export const SITE_URL = 'https://forthcanoeclub.co.uk';
const DESCRIPTIONS = {
  home: 'Paddle with Forth Canoe Club in Edinburgh. Discover canoeing, kayaking, club sessions and ways to get involved.',
  membership: 'Join Forth Canoe Club and explore membership, boat hire, coaching and event tickets.',
  beginners: 'Start canoeing or kayaking in Edinburgh with Forth Canoe Club. Find beginner sessions and what to bring.',
  disciplines: 'Explore canoeing and kayaking disciplines and the regular session timetable at Forth Canoe Club.',
  volunteering: 'Help Forth Canoe Club on and off the water. Find volunteering opportunities and register your interest.',
  about: 'Learn about Forth Canoe Club SCIO, our history and our Edinburgh paddling community.',
  'contact-us': 'Contact Forth Canoe Club for membership, beginner sessions and club enquiries.',
  safeguarding: 'Read Forth Canoe Club safeguarding information and find support and reporting contacts.',
  notices: 'Read Forth Canoe Club notices covering privacy, data use and the terms for joining or booking.',
  'access-project': 'Learn about Forth Canoe Club improvements to paddling access and facilities.'
};
const PRIVATE_TITLES = {
  admin: 'Admin', 'admin-reports': 'Admin Reports', 'club-night': 'Check-ins',
  'my-details': 'My Details', checkout: 'Checkout', 'order-lookup': 'Order',
  'payment-success': 'Payment', 'payment-issue': 'Payment'
};

export function pageMetadata(page) {
  const route = PUBLIC_ROUTES[page];
  return {
    title: `${route?.title || PRIVATE_TITLES[page] || 'Page not found'} | Forth Canoe Club SCIO`,
    description: DESCRIPTIONS[page] || (PRIVATE_TITLES[page]
      ? 'Manage your Forth Canoe Club booking, membership or club records.'
      : 'This page is missing. Find your way back to Forth Canoe Club.'),
    robots: route ? 'index, follow' : 'noindex, nofollow',
    canonical: route ? `${SITE_URL}${route.path}` : null
  };
}
