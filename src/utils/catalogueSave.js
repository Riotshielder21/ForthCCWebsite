import { cleanRosterViewers } from './eventRoster.js';

/** Product data and private viewer access use separate stores; report a partial save explicitly. */
export const saveCatalogueItem = async (product, viewerText, { saveProduct, saveViewers }) => {
  const viewers = product.category === 'EVENTS'
    ? cleanRosterViewers(viewerText.split(/[\s,;]+/).filter(Boolean)) : null;
  await saveProduct(product);
  if (viewers !== null) {
    try {
      await saveViewers(product.id, viewers);
    } catch (error) {
      throw new Error(`Item details saved, but attendee-list viewers were not saved: ${error.message} Click Save all to retry.`);
    }
  }
  return viewers;
};
