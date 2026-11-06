import { apiUrl, apiFetch } from './api';
import { savePublicSnapshot } from './publicSnapshots';

export function prepareOfflineSite(onStatus) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return () => {};
  let active = true;
  let timer;
  let registration;
  const notify = (state) => { if (active) onStatus(state); };
  const check = () => requestStatus('PUBLIC_CACHE_STATUS');
  const requestStatus = (type) => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      channel.port1.close();
      if (!event.data.ready && type === 'PUBLIC_CACHE_STATUS' && navigator.onLine) requestStatus('PUBLIC_CACHE_REPAIR');
      else notify(event.data.ready ? 'ready' : 'unavailable');
    };
    worker.postMessage({ type }, [channel.port2]);
  };
  const register = async () => {
    notify('saving');
    apiFetch(apiUrl('/api/volunteering'), { credentials: 'omit', priority: 'low' }).then(async (response) => {
      if (!response.ok) throw new Error(`Could not download public volunteering information (${response.status}).`);
      savePublicSnapshot('volunteering', await response.json());
    }).catch((error) => console.error('Public volunteering information could not be saved:', error));
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      if (!active) return;
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'redundant') notify('unavailable');
          if (worker.state === 'installed' && registration.waiting) notify('update');
        });
      });
      if (registration.waiting) notify('update');
      else check();
    } catch (error) {
      console.error('Offline public-page setup failed:', error);
      notify('unavailable');
    }
  };
  const schedule = () => { timer = setTimeout(register, 1500); };
  navigator.serviceWorker.addEventListener('controllerchange', check);
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    active = false;
    clearTimeout(timer);
    window.removeEventListener('load', schedule);
    navigator.serviceWorker.removeEventListener('controllerchange', check);
  };
}
