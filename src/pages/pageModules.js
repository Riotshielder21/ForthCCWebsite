export const pageModules = {
  home: () => import('./HomePage'),
  membership: () => import('./MembershipPage'),
  beginners: () => import('./BeginnersPage'),
  disciplines: () => import('./DisciplinesPage'),
  volunteering: () => import('./VolunteeringPage'),
  about: () => import('./AboutPage'),
  'contact-us': () => import('./ContactUsPage'),
  safeguarding: () => import('./SafeguardingPage'),
  'access-project': () => import('./AccessProjectPage'),
  admin: () => import('./AdminPage'),
  'admin-reports': () => import('./AdminReportsPage'),
  'club-night': () => import('./ClubNightPage'),
  'my-details': () => import('./MyDetailsPage'),
  checkout: () => import('./CheckoutPage'),
  'order-lookup': () => import('./OrderLookupPage'),
  'payment-success': () => import('./PaymentSuccessPage')
};
