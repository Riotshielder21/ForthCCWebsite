import { IMAGE_PRESETS, MAX_IMAGE_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES, UPLOAD_IMAGE_TYPES, plannedWidths } from './responsiveImages.js';

const WEBP_QUALITY = 0.8;
const FALLBACK_QUALITY = 0.85;
const PLACEHOLDER_WIDTH = 30;

const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

const drawCanvas = (source, width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
};

const hasTransparency = (bitmap) => {
  const canvas = drawCanvas(bitmap, 64, Math.max(1, Math.round(64 * (bitmap.height / bitmap.width))));
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) if (data[index] < 255) return true;
  return false;
};

// A JPEG or PNG every email client and older browser can show. PNG keeps transparent logos transparent.
const plainBlob = async (canvas, transparent) => {
  const blob = transparent ? await canvasBlob(canvas, 'image/png') : await canvasBlob(canvas, 'image/jpeg', FALLBACK_QUALITY);
  if (!blob) throw new Error('This browser could not resize the photo.');
  return blob;
};

// Browsers that cannot encode WebP return PNG instead, which is far larger, so use the plain format for those.
const compressedBlob = async (canvas, transparent) => {
  const blob = await canvasBlob(canvas, 'image/webp', WEBP_QUALITY);
  return blob?.type === 'image/webp' ? blob : plainBlob(canvas, transparent);
};

const dataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('This browser could not create the photo preview.'));
  reader.readAsDataURL(blob);
});

export const checkUploadImage = (file) => {
  if (!file || !UPLOAD_IMAGE_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error('Photos must be 25 MB or smaller.');
};

/**
 * Resizes a photo in the browser before upload. Returns compressed copies at each preset width up to the photo's
 * own width, one plain JPEG/PNG fallback and a tiny base64 preview. The full-size original is not kept.
 */
export async function prepareResponsiveImage(file, presetName) {
  const preset = IMAGE_PRESETS[presetName];
  if (!preset) throw new Error('Unknown image type.');
  checkUploadImage(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    .catch(() => { throw new Error('This photo could not be read. Try a JPG or PNG copy.'); });
  try {
    const { width: sourceWidth, height: sourceHeight } = bitmap;
    const transparent = file.type !== 'image/jpeg' && hasTransparency(bitmap);
    const heightFor = (width) => Math.max(1, Math.round(sourceHeight * (width / sourceWidth)));
    const widths = plannedWidths(sourceWidth, preset.widths);
    // Always one of the planned widths: either the preset's fallback width or the photo's own, smaller, width.
    const fallbackWidth = Math.min(preset.fallbackWidth, widths.at(-1));
    const renditions = [];
    let fallback = null;
    // Largest first, each drawn from the previous size: stepped downscaling is sharper and quicker than one big jump.
    let previous = bitmap;
    for (const width of [...widths].reverse()) {
      const canvas = drawCanvas(previous, width, heightFor(width));
      const blob = await compressedBlob(canvas, transparent);
      if (blob.size >= MAX_STORED_IMAGE_BYTES) throw new Error('The resized photo is still too large. Try a smaller or less detailed photo.');
      renditions.unshift({ blob, width, height: canvas.height });
      if (width === fallbackWidth) {
        // When WebP is unavailable the compressed copy is already plain JPEG/PNG, so it doubles as the fallback.
        fallback = blob.type === 'image/webp' ? { blob: await plainBlob(canvas, transparent), width, height: canvas.height } : { reuse: width };
      }
      previous = canvas;
    }
    // Transparent logos have no preview: a blurred copy would show through their transparent areas.
    let placeholder = '';
    if (!transparent) {
      const previewCanvas = drawCanvas(previous, PLACEHOLDER_WIDTH, heightFor(PLACEHOLDER_WIDTH));
      const preview = await canvasBlob(previewCanvas, 'image/webp', 0.5);
      placeholder = await dataUrl(preview?.type === 'image/webp' ? preview : await canvasBlob(previewCanvas, 'image/jpeg', 0.5));
    }
    return { renditions, fallback, placeholder, sourceWidth, sourceHeight };
  } finally {
    bitmap.close();
  }
}
