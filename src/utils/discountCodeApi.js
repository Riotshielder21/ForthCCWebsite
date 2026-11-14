import { apiUrl, apiFetch } from './api';

export const validateDiscountCode = async (code) => {
  const response = await apiFetch(apiUrl('/api/discount-codes/validate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not validate discount code.');
  return result;
};