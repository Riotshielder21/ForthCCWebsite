const validators = {
  products: (value) => Array.isArray(value) && value.every((product) => product && typeof product.id === 'string'),
  volunteering: (value) => value && typeof value.content?.title === 'string' && Array.isArray(value.tiers)
};

export function readPublicSnapshot(key) {
  try {
    const raw = localStorage.getItem(`fcc-public-${key}`);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!validators[key]?.(value)) throw new Error(`Invalid public ${key} snapshot.`);
    return value;
  } catch (error) {
    console.error(`Public ${key} snapshot could not be restored:`, error);
    return null;
  }
}

export function savePublicSnapshot(key, value) {
  if (!validators[key]?.(value)) throw new Error(`Invalid public ${key} snapshot.`);
  try {
    localStorage.setItem(`fcc-public-${key}`, JSON.stringify(value));
  } catch (error) {
    console.error(`Public ${key} snapshot could not be saved for offline reading:`, error);
  }
}
