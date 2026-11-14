import { safeTileUrl } from './contentLinks.js';

/**
 * Uploaded photos are resized in the admin's browser into the widths below (never larger than the photo itself).
 * Visitors download only the smallest width that covers the image's box on their screen, so a phone never receives
 * the 4K banner. `fallbackWidth` is the plain JPEG/PNG copy used by email receipts, offline reading and old browsers.
 */
export const IMAGE_PRESETS = {
  banner: { widths: [640, 960, 1280, 1600, 1920, 2560, 3840], fallbackWidth: 960, recommendedWidth: 2560 },
  content: { widths: [320, 480, 640, 960, 1280, 1920], fallbackWidth: 640, recommendedWidth: 1280 },
  logo: { widths: [160, 320, 640], fallbackWidth: 320, recommendedWidth: 320 }
};
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
// Each stored size must stay under the Storage rules limit (see storage.rules).
export const MAX_STORED_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SOURCES = 8;
export const MAX_PLACEHOLDER_LENGTH = 4000;
// Above 2x, extra pixels are not visible at normal viewing distance but still cost download time and traffic.
export const MAX_PIXEL_RATIO = 2;
export const UPLOAD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const plannedWidths = (sourceWidth, widths) => {
  if (!Number.isFinite(sourceWidth) || sourceWidth < 1) return [];
  const top = Math.min(Math.round(sourceWidth), widths.at(-1));
  return [...new Set([...widths.filter((width) => width < top), top])];
};

const validSize = (value) => Number.isInteger(value) && value > 0 && value <= 10000;
// Links are written into srcset-style lists and CSS, so commas, spaces, quotes and brackets are refused.
const plainUrl = (url) => typeof url === 'string' && url.length <= 2000 && !/[\s,'"()\\]/.test(url) && Boolean(safeTileUrl(url, true));

/** Validates the stored sizes for one image. Throws on anything that is not a list of secure links with sizes. */
export const validateImageSources = (sources) => {
  if (sources === undefined) return [];
  if (!Array.isArray(sources) || sources.length > MAX_IMAGE_SOURCES) throw new Error('Invalid image sizes.');
  const seen = new Set();
  return sources.map((source) => {
    if (!source || typeof source !== 'object' || !plainUrl(source.url) || !validSize(source.width) || !validSize(source.height)
      || seen.has(source.width)) throw new Error('Invalid image sizes.');
    seen.add(source.width);
    return { url: safeTileUrl(source.url, true), width: source.width, height: source.height };
  }).sort((a, b) => a.width - b.width);
};

const PLACEHOLDER = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/** The tiny inline preview shown while the real image downloads. Only base64 image data is accepted. */
export const validateImagePlaceholder = (value) => {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > MAX_PLACEHOLDER_LENGTH || !PLACEHOLDER.test(value)) throw new Error('Invalid image preview.');
  return value;
};

// Rendering never throws: content saved before validation existed falls back to the single image link.
export const usableImageSources = (sources) => {
  try { return validateImageSources(sources); } catch { return []; }
};
export const usablePlaceholder = (value) => {
  try { return validateImagePlaceholder(value); } catch { return ''; }
};

/**
 * The image width in device pixels needed to fill a box without visible softening. A cover-cropped photo is drawn
 * wider than its box when the box is taller than the photo's shape, as banners are on phones. A contained image is
 * drawn no wider than its box and no taller than it, so a short wide box (a logo strip) needs fewer pixels.
 */
export const requiredImageWidth = ({ boxWidth, boxHeight = 0, aspect = 0, fit = 'cover', pixelRatio = 1 }) => {
  const ratio = Math.min(Math.max(Number(pixelRatio) || 1, 1), MAX_PIXEL_RATIO);
  const width = Math.max(Number(boxWidth) || 0, 0);
  const heightWidth = aspect > 0 ? Math.max(Number(boxHeight) || 0, 0) * aspect : 0;
  let cssWidth = width;
  if (fit === 'cover') cssWidth = Math.max(width, heightWidth);
  else if (heightWidth) cssWidth = width ? Math.min(width, heightWidth) : heightWidth;
  return Math.ceil(cssWidth * ratio);
};

/** The smallest stored size at least as wide as needed, or the largest when none is. */
export const chooseImageSource = (sources, neededWidth) => sources.find((source) => source.width >= neededWidth) || sources.at(-1);
export const priorityImageWidth = (neededWidth) => Math.ceil(neededWidth * 1.25);
