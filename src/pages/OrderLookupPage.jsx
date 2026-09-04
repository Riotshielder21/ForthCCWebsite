import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export default function OrderLookupPage() {
  const [state, setState] = useState({ loading: true, order: null, error: '' });

  useEffect(() => {
    const accessKey = window.location.pathname.split('/').filter(Boolean).pop();
    fetch(`/api/orders/${encodeURIComponent(accessKey || '')}`)
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
        {state.loading && <div className="ContentPanel"><p className="ContentBody">Loading your receipt...</p></div>}
        {state.error && <div className="ContentPanel"><AlertCircle className="ReceiptCheckIcon text-red-500" /><h2 className="ContentTitle">Receipt unavailable</h2><p className="ContentBody">{state.error}</p></div>}
        {state.order && <div className="ContentPanel"><CheckCircle2 className="ReceiptCheckIcon" /><h2 className="ContentTitle">Your purchase</h2><p className="ReceiptLabel">Order reference</p><p className="ReceiptValue SpaceB6">{state.order.orderRef}</p>{state.order.items.map((item) => <div className="ReceiptLineItem" key={item.name}><span className="ReceiptItemName">{item.name}</span><span className="ReceiptItemPrice">£{Number(item.price).toFixed(2)}</span></div>)}<div className="ReceiptTotalRow SpaceT6"><span className="ReceiptTotalLabel">Total</span><span className="ReceiptTotalValue">£{Number(state.order.total).toFixed(2)}</span></div></div>}
      </div>
    </div>
  );
}