import { normaliseProduct, validateEventSchedule } from './catalogue.js';
import { cleanStockFields } from './inventory.js';
import { validateImagePlaceholder, validateImageSources } from './responsiveImages.js';

/** The database fields for a product, apart from `active` and `updatedAt`, which the caller sets. */
export const productRecord = (product) => {
  const { id, ...fields } = normaliseProduct(product);
  if (fields.pricingMode !== 'subscription') fields.hasAnnualDiscount = false;
  if (product.category === 'EVENTS') fields.eventSchedule = validateEventSchedule(product.eventSchedule);
  if (Object.hasOwn(product, 'imageUrl')) {
    const hasImage = Boolean(fields.imageUrl);
    fields.imageSources = hasImage ? validateImageSources(product.imageSources) : [];
    fields.imagePlaceholder = hasImage ? validateImagePlaceholder(product.imagePlaceholder) : '';
  }
  return { id, fields: { ...fields, ...cleanStockFields(product) } };
};
