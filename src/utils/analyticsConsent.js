/** The visitor's analytics choice, kept in this browser. Analytics stays off until it is explicitly allowed. */
const KEY = 'fcc-analytics-consent';

export const analyticsChoice = () => {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'granted' || value === 'denied' ? value : '';
  } catch {
    return '';
  }
};

export const analyticsAllowed = () => analyticsChoice() === 'granted';

export const setAnalyticsChoice = (granted) => {
  try { localStorage.setItem(KEY, granted ? 'granted' : 'denied'); } catch { /* storage blocked: analytics stays off */ }
};
