import { parsePhoneNumberFromString } from 'libphonenumber-js';

const NAME = /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u;
const UK_POSTCODE = /^(?:GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[ABD-HJLNP-UW-Z]{2})$/;
const BFPO_POSTCODE = /^BFPO\d{1,4}$/;

export const normaliseName = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
export const isValidPersonName = (value) => {
  const name = normaliseName(value);
  return Boolean(name && name.length <= 120 && NAME.test(name));
};

export const normalisePhoneNumber = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = parsePhoneNumberFromString(value.trim(), 'GB');
  return parsed?.isValid() ? parsed.number : null;
};

export const normaliseUkPostcode = (value) => {
  if (typeof value !== 'string') return null;
  const compact = value.toUpperCase().replace(/\s+/g, '');
  if (BFPO_POSTCODE.test(compact)) return `BFPO ${compact.slice(4)}`;
  if (compact === 'GIR0AA') return 'GIR 0AA';
  if (!UK_POSTCODE.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
};

export const normaliseAffiliationNumber = (value) => {
  if (typeof value !== 'string') return null;
  const number = value.trim();
  if (!number) return '';
  if (!/^\d{1,6}$/.test(number) || Number(number) < 1 || Number(number) > 999999) return null;
  return number;
};
