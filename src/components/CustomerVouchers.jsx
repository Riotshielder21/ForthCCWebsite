import React, { useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';

const date = (millis) => millis ? new Date(millis).toLocaleDateString('en-GB') : '-';

// Shows the vouchers held against a customer's email, so a lost code can be read from their record.
export default function CustomerVouchers({ adminUser, email }) {
  const [state, setState] = useState({ loading: true, vouchers: [], error: '' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await adminUser.getIdToken();
        const response = await fetch(apiUrl(`/api/admin/customer?q=${encodeURIComponent(email)}`), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const result = await response.json().catch(() => null);
        if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
        if (response.status === 404) return active && setState({ loading: false, vouchers: [], error: '' });
        if (!response.ok) throw new Error(result.error || 'Could not load vouchers.');
        if (active) setState({ loading: false, vouchers: result.vouchers, error: '' });
      } catch (error) {
        if (active) setState({ loading: false, vouchers: [], error: error.message });
      }
    })();
    return () => { active = false; };
  }, [adminUser, email]);

  if (state.loading) return <p className="ReportNotice">Loading vouchers…</p>;
  if (state.error) return <p className="StatusTextError" role="alert">{state.error}</p>;
  if (!state.vouchers.length) return <p className="ReportNotice">No vouchers on this customer's record.</p>;
  return (
    <div>
      <h4 className="CartItemTitle">Vouchers</h4>
      <table className="ReportsTable">
        <thead><tr><th scope="col">Code</th><th scope="col">Value</th><th scope="col">Status</th><th scope="col">Expires</th><th scope="col">Used in order</th></tr></thead>
        <tbody>
          {state.vouchers.map((voucher) => (
            <tr key={voucher.code}>
              <td><code>{voucher.code}</code></td>
              <td>£{Number(voucher.value).toFixed(2)}</td>
              <td>{voucher.status}{voucher.usedAt ? ` (${date(voucher.usedAt)})` : ''}</td>
              <td>{date(voucher.expiresAt)}</td>
              <td>{voucher.usedByOrder || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
