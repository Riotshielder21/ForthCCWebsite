import { relativeClubLink } from './routes.js';

export const safeTileUrl = (value, image = false) => {
  if (typeof value !== 'string' || !value) return '';
  try {
    const normalised = relativeClubLink(value);
    const url = new URL(normalised, 'https://forthcanoeclub.co.uk');
    if (url.protocol === 'https:' || (!image && url.protocol === 'mailto:')) return normalised;
  } catch {
    return '';
  }
  return '';
};

export function parseContentLinks(value) {
  const parts = [];
  let start = 0;
  for (const match of value.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
    if (match.index > start) parts.push({ text: value.slice(start, match.index), start, end: match.index });
    parts.push({ text: match[1], url: match[2], start: match.index, end: match.index + match[0].length });
    start = match.index + match[0].length;
  }
  if (start < value.length) parts.push({ text: value.slice(start), start, end: value.length });
  return parts;
}

export function validateContentLinks(value) {
  for (const part of parseContentLinks(value)) {
    if (part.url && !safeTileUrl(part.url)) throw new Error('Links must use HTTPS, a website-relative URL, or mailto.');
  }
  return value;
}

export function replaceContentLink(value, start, end, label, url) {
  if (!label.trim() || /[\[\]\r\n]/.test(label)) throw new Error('Enter link text without square brackets or line breaks.');
  if (url && (!safeTileUrl(url) || /\s/.test(url))) throw new Error('Enter an HTTPS, website-relative, or mailto link without spaces.');
  const replacement = url ? `[${label}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})` : label;
  return value.slice(0, start) + replacement + value.slice(end);
}

export function validateContentButton(button) {
  if (button === null) return null;
  if (!button || typeof button !== 'object' || Array.isArray(button)
    || typeof button.label !== 'string' || !button.label.trim() || button.label.length > 20000
    || typeof button.url !== 'string' || !button.url || !safeTileUrl(button.url) || /\s/.test(button.url)) {
    throw new Error('A custom button needs text and an HTTPS, website-relative, or mailto link.');
  }
  return { label: button.label, url: button.url };
}
