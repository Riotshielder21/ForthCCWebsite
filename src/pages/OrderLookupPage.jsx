import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiUrl } from '../utils/api';
import PurchaseReceipt from '../components/PurchaseReceipt';

export default function OrderLookupPage() {
  const [state, setState] = useState({ loading: true, order: null, error: '' });

  useEffect(() => {
    const accessKey = window.location.pathname.split('/').filter(Boolean).pop();
    fetch(apiUrl(`/api/orders/${encodeURIComponent(accessKey || '')}`))
      .then(async (response) => {
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : {};
        if (!response.ok) throw new Error(data.error || 'This receipt could not be found.');
        return data;
      })
      .then((order) => setState({ loading: false, order, error: '' }))
      .catch((error) => setState({ loading: false, order: null, error: error.message }));
  }, []);

  return (
    <div className="SectionBottom PageFadeIn">
      <div className="ReceiptWrapper">
        {state.loading && <div className="main_tile"><p className="text_container">Loading your receipt...</p></div>}
        {state.error && <div className="main_tile"><AlertCircle className="ReceiptCheckIcon text-red-500" /><h2 className="tile_heading_bold_1">Receipt unavailable</h2><p className="text_container">{state.error}</p></div>}
        {state.order && <>
          <div className="ReceiptHeader">
            <CheckCircle2 className="ReceiptCheckIcon" aria-hidden="true" />
            <h2 className="tile_heading_bold_1">Your Purchase</h2>
            <p className="PageIntroCentered">Here’s a summary of your purchase. Keep your confirmation email for your records.</p>
          </div>
          <PurchaseReceipt order={state.order} />
        </>}
      </div>
    </div>
  );
}