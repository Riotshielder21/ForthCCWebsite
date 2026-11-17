import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCTS } from '../constants/products.js';
import { apiFetch, apiUrl } from '../utils/api.js';
import { subscribeToProducts } from '../utils/content.js';
import { readPublicSnapshot, savePublicSnapshot } from '../utils/publicSnapshots.js';

export function usePublicCatalogue(currentPage, basketOpen) {
  const [products, setProducts] = useState(() => readPublicSnapshot('products') || PRODUCTS);
  const [availability, setAvailability] = useState({});
  const [catalogueLive, setCatalogueLive] = useState(false);
  const [refresh, setRefresh] = useState({ refreshing: false, error: '' });
  const [adminError, setAdminError] = useState('');
  const revision = useRef(0);
  const adminPage = currentPage === 'admin' || currentPage === 'admin-reports';

  const refreshAvailability = useCallback(async () => {
    const request = ++revision.current;
    setRefresh({ refreshing: true, error: '' });

    try {
      const response = await apiFetch(apiUrl('/api/availability'), { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not refresh availability (${response.status}).`);

      const result = await response.json();
      if (!result?.availability || typeof result.availability !== 'object' || Array.isArray(result.availability)
        || !Array.isArray(result.products) || result.products.some((product) => typeof product?.id !== 'string')) {
        throw new Error('Invalid availability response.');
      }
      if (request !== revision.current) return { ok: false, superseded: true };

      setAvailability(result.availability);
      // Admins receive their catalogue from Firestore, not an overlapping public refresh.
      if (!adminPage) {
        setProducts(result.products);
        setCatalogueLive(true);
        savePublicSnapshot('products', result.products);
      }
      setRefresh({ refreshing: false, error: '' });
      return { ok: true };
    } catch (error) {
      if (request !== revision.current) return { ok: false, superseded: true };
      console.error('Availability refresh failed:', error);
      const message = 'Prices and availability could not be checked. Displayed details may be out of date; checkout checks them again.';
      setRefresh({ refreshing: false, error: message });
      return { ok: false, error: message };
    }
  }, [adminPage]);

  useEffect(() => {
    void refreshAvailability();
    return () => { revision.current += 1; };
  }, [currentPage, basketOpen, refreshAvailability]);

  useEffect(() => {
    setAdminError('');
    if (!adminPage) return undefined;

    return subscribeToProducts((remoteProducts) => {
      setProducts(remoteProducts);
      setCatalogueLive(true);
      setAdminError('');
    }, (error) => {
      console.error('Product catalogue unavailable:', error);
      setAdminError('The admin catalogue could not be loaded. Reload to reconnect.');
    });
  }, [adminPage]);

  return {
    products,
    availability,
    catalogueLive,
    refreshAvailability,
    refresh: { ...refresh, error: adminError || refresh.error }
  };
}
