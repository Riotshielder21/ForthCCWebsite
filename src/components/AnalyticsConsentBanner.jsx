import React, { useEffect, useState } from 'react';
import { analyticsAllowed, analyticsChoice, setAnalyticsChoice } from '../utils/analyticsConsent';

const loadAnalytics = (granted) => import('../utils/firebase')
  .then((firebase) => (granted ? firebase.startAnalytics() : firebase.stopAnalytics()))
  .catch((error) => console.error('Could not update Google Analytics:', error));

/** Requests an explicit choice once; `open` lets visitors change it later. */
export default function AnalyticsConsentBanner({ open, onClose }) {
  const [asked, setAsked] = useState(() => analyticsChoice() !== '');
  useEffect(() => {
    if (!analyticsAllowed()) return undefined;
    const start = () => loadAnalytics(true);
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(start, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(start, 2000);
    return () => window.clearTimeout(id);
  }, []);
  if (asked && !open) return null;
  const choose = (granted) => {
    setAnalyticsChoice(granted);
    loadAnalytics(granted);
    setAsked(true);
    onClose?.();
  };
  return <section className="AnalyticsConsent" role="region" aria-label="Google Analytics choice">
    <p>Help us improve the website? Allow Google Analytics? <a href="/notices#cookies-and-analytics">Details</a>{open ? ` · Currently: ${analyticsAllowed() ? 'allowed' : 'not allowed'}` : ''}</p>
    <div className="AnalyticsConsentActions">
      <button type="button" className="PrimaryActionButtonCompact" onClick={() => choose(true)}>Allow analytics</button>
      <button type="button" className="EditorCommand" onClick={() => choose(false)}>No thanks</button>
    </div>
  </section>;
}
