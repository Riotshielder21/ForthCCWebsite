import { DISCOUNTS } from '../constants/products.js';

const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateCart = (cart, isAnnual, promo = null, now = new Date()) => {
  const startYear = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  const nextClubYearStart = new Date(startYear + 1, 2, 1);
  const monthsRemaining = Math.max(1, (nextClubYearStart.getFullYear() - now.getFullYear()) * 12 + 2 - now.getMonth());
  const clubYear = { now, nextClubYearStart, monthsRemaining };
  const items = cart.map((item) => {
    // Catalogue items carry pricingMode (see productTerms); anything without one is fixed unless it is a subscription.
    const pricingMode = item.pricingMode || (item.type === 'subscription' ? 'subscription' : 'fixed');
    const monthlyBilling = pricingMode === 'subscription' && !isAnnual && (item.allowMonthly ?? item.type === 'subscription');
    // A code limited to products or categories covers just those; otherwise everything except membership.
    const promoEligible = promo?.productIds?.length || promo?.categories?.length
      ? Boolean(promo.productIds?.includes(item.id) || promo.categories?.includes(item.category))
      : item.category !== 'MEMBERSHIP';
    const flat = promoEligible && promo?.discountType === 'flat' && pricingMode === 'subscription';
    const monthly = flat ? Math.max(0, item.basePrice - promo.discountValue) : item.basePrice;
    const annualRate = item.hasAnnualDiscount && (!flat || promo.allowsAnnualStacking) ? 1 - DISCOUNTS.ANNUAL : 1;
    let subtotalPrice = item.basePrice;
    let displayPrice = subtotalPrice;
    let annualSaving = 0;
    let promoSaving = 0;
    let recurringMonthlyCost = 0;
    let label = 'One-off';
    if (pricingMode === 'subscription') {
      const months = monthlyBilling ? 1 : monthsRemaining;
      subtotalPrice = money(item.basePrice * months * (monthlyBilling ? 1 : annualRate));
      displayPrice = money(monthly * months * (monthlyBilling ? 1 : annualRate));
      annualSaving = monthlyBilling ? 0 : money(item.basePrice * months - subtotalPrice);
      promoSaving = money(subtotalPrice - displayPrice);
      recurringMonthlyCost = monthlyBilling ? monthly : 0;
      label = monthlyBilling ? 'Monthly' : `Until ${nextClubYearStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    } else if (pricingMode === 'prorated') {
      displayPrice = money(item.basePrice * (monthsRemaining <= 4 ? 0.6 : 1));
      subtotalPrice = displayPrice;
      annualSaving = money(item.basePrice - displayPrice);
      label = 'Club Year';
    } else if (item.type === 'annual-oneoff' || item.type === 'yearly-service') {
      label = 'Club Year';
    }
    // Automatic trip discounts (see tripDiscount.js) come off before any promo code.
    const tripSaving = money(Math.min(Math.max(0, Number(item.tripDiscount) || 0), displayPrice));
    displayPrice = money(displayPrice - tripSaving);
    if (promoEligible && promo?.discountType === 'multiplier') {
      const saving = money(displayPrice * promo.discountValue);
      displayPrice = money(displayPrice - saving);
      promoSaving += saving;
      recurringMonthlyCost = money(recurringMonthlyCost * (1 - promo.discountValue));
    }
    return { ...item, label, subtotalPrice, displayPrice, annualSaving, promoSaving, tripSaving, promoEligible, recurringMonthlyCost, monthlyBilling, clubYear };
  });
  let credit = promo?.discountType === 'credit' ? promo.discountValue : 0;
  for (const item of items) {
    if (!item.promoEligible || credit <= 0) continue;
    const saving = money(Math.min(credit, item.displayPrice));
    item.displayPrice = money(item.displayPrice - saving);
    item.promoSaving = money(item.promoSaving + saving);
    credit = money(credit - saving);
  }
  const sum = (field) => money(items.reduce((total, item) => total + item[field], 0));
  const total = sum('displayPrice');
  return { items, subtotal: sum('subtotalPrice'), annualSaving: sum('annualSaving'), promoDiscountValue: sum('promoSaving'), tripDiscountValue: sum('tripSaving'), total, year1Total: total, recurringMonthlyTotal: sum('recurringMonthlyCost') };
};