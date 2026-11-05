import React, { useEffect, useState } from 'react';
import { prepareOfflineSite } from '../utils/offline';
import { PUBLIC_ROUTES } from '../utils/routes';

export default function OfflineStatus({ currentPage }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [status, setStatus] = useState('');
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => prepareOfflineSite(setStatus), []);
  const publicPage = Boolean(PUBLIC_ROUTES[currentPage]);
  if (!online) return <p className="OfflineStatus" role="status">
    You are offline. {publicPage ? 'Downloaded public pages can still be read; content, prices and schedules may be out of date.' : 'This page needs an internet connection.'}
    {' '}Signing in, availability checks, forms and payments require a connection.
  </p>;
  if (status === 'unavailable') return <p className="OfflineStatus" role="status">Public pages could not be fully saved for offline use. Reconnect and reload to try again.</p>;
  if (status === 'update') return <p className="OfflineStatus" role="status">A website update is ready. Close all club website tabs and reopen the site to use it.</p>;
  if (status === 'ready') return <p className="OfflineStatus" role="status">Public pages saved for offline reading. External services and live booking details require a connection.</p>;
  return null;
}
