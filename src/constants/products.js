// Discount tiers
export const DISCOUNTS = {
  ANNUAL: 0.20
};

// Promo codes with their benefits
// discountType: 'flat' = £ amount off monthly price, 'multiplier' = percentage off (0.25 = 25%)
// When a flat discount is applied, annual = discounted monthly × 12 (no annual discount stacking)
// a seperate special category of codes that apply a flat discount that also allows annual
//  discount stacking is availible as a "special" discount
export const VALID_PROMO_CODES = {
  'VOLUNTEER20': { label: 'Volunteer 20+ Hours', discountType: 'flat', discountValue: 5.00 },
  'VOLUNTEER40': { label: 'Volunteer 40+ Hours', discountType: 'flat', discountValue: 10.00 },
  'SaverSupreme': { label: 'Saver Supreme', discountType: 'multiplier', discountValue: 0.20 },
  'SpecialFlat5': { label: 'Special £5 Off', discountType: 'flat', discountValue: 5.00, allowsAnnualStacking: true }
};

// Product categories
export const CATEGORIES = ['ALL', 'MEMBERSHIP', 'SERVICES', 'SUBSCRIPTIONS', 'VOUCHERS'];

// All available products
export const PRODUCTS = [
  {
    id: 'boat-hire',
    name: 'ANNUAL BOAT & KIT HIRE',
    category: 'SERVICES',
    basePrice: 85.00,
    description: 'Unlimited kit hire for the club year. Pay upfront or spread the cost monthly.',
    type: 'yearly-service'
  },
  {
    id: 'club-membership',
    name: 'CLUB MEMBERSHIP Via JUSTGO',
    category: 'MEMBERSHIP',
    basePrice: 0,
    priceLabel: 'Starting from £12.50',
    description: 'Required for anyone paddling with us after 3 trial sessions. Managed via JustGo.',
    externalLink: 'https://sca.justgo.com/Workbench/Show/5',
    type: 'external'
  },
  {
    id: 'membership-junior',
    name: 'CLUB MEMBERSHIP — JUNIOR',
    category: 'MEMBERSHIP',
    basePrice: 17.50,
    description: 'For paddlers aged 8–17. Includes SCA membership. Club year runs from 1 March.',
    type: 'annual-oneoff',
    membershipTier: 'junior'
  },
  {
    id: 'membership-adult',
    name: 'CLUB MEMBERSHIP — ADULT',
    category: 'MEMBERSHIP',
    basePrice: 30.00,
    description: 'Individual adult membership. Includes SCA membership. Club year runs from 1 March.',
    type: 'annual-oneoff',
    membershipTier: 'adult'
  },
  {
    id: 'membership-family',
    name: 'CLUB MEMBERSHIP — FAMILY',
    category: 'MEMBERSHIP',
    basePrice: 50.00,
    description: 'Covers all members of a household. Includes SCA membership. Club year runs from 1 March.',
    type: 'annual-oneoff',
    membershipTier: 'family'
  },
  {
    id: 'blue-sub',
    name: 'BLUE SUBSCRIPTION',
    category: 'SUBSCRIPTIONS',
    basePrice: 25.00,
    description: 'One (1) coached session per week. Covers Polo, Slalom, or Sprint, River Trips and more.',
    hasAnnualDiscount: true,
    type: 'subscription'
  },
  {
    id: 'gold-sub',
    name: 'GOLD SUBSCRIPTION',
    category: 'SUBSCRIPTIONS',
    basePrice: 30.00,
    description: 'Unlimited coached sessions. Ideal for competitive Sprint and Marathon paddlers, Canoe polo and more.',
    hasAnnualDiscount: true,
    type: 'subscription'
  },
  {
    id: 'vouchers',
    name: 'Course place voucher',
    category: 'VOUCHERS',
    basePrice: 60.00,
    description: 'Recieve a code and giftvoucher for a friend or family member to use against any of our courses. Valid for 1 year.',
    hasAnnualDiscount: false,
    allowsAnnualStacking: false,
    type: 'voucher'
  },
  {
    id: 'keyhire',
    name: 'Boathouse Access',
    category: 'SERVICES',
    basePrice: 50.00,
    description: 'Get access to the boathouse and facilities with our key hire. Pay annually only.',
    hasAnnualDiscount: false,
    allowsAnnualStacking: false,
    type: 'yearly-service'
  }
];
