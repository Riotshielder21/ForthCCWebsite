// Discount tiers
export const DISCOUNTS = {
  ANNUAL: 0.33,
  VOLUNTEER: 0.25
};

// Promo codes with their benefits
export const VALID_PROMO_CODES = {
  'VOLUNTEER25': { type: 'VOLUNTEER', value: 0.25 }
};

// Product categories
export const CATEGORIES = ['ALL', 'MEMBERSHIP', 'EQUIPMENT', 'SUBSCRIPTIONS'];

// All available products
export const PRODUCTS = [
  {
    id: 'boat-hire',
    name: 'ANNUAL BOAT & KIT HIRE',
    category: 'EQUIPMENT',
    basePrice: 7.08,
    description: 'Unlimited kit hire for the year. Billed monthly.',
    type: 'monthly-service'
  },
  {
    id: 'club-membership',
    name: 'CLUB MEMBERSHIP (JUSTGO)',
    category: 'MEMBERSHIP',
    basePrice: 0,
    priceLabel: 'Varies',
    description: 'Required for anyone paddling with us after 3 trial sessions. Managed via JustGo.',
    externalLink: 'https://sca.justgo.com/Workbench/Show/5',
    type: 'external'
  },
  {
    id: 'blue-sub',
    name: 'BLUE SUBSCRIPTION',
    category: 'SUBSCRIPTIONS',
    basePrice: 20.00,
    description: 'One (1) coached session per week. Covers Polo, Slalom, or Sprint, River Trips and more.',
    hasAnnualDiscount: true,
    type: 'subscription'
  },
  {
    id: 'gold-sub',
    name: 'GOLD SUBSCRIPTION',
    category: 'SUBSCRIPTIONS',
    basePrice: 25.00,
    description: 'Unlimited coached sessions. Ideal for competitive Sprint and Marathon paddlers, Canoe polo and more.',
    hasAnnualDiscount: true,
    type: 'subscription'
  }
];
