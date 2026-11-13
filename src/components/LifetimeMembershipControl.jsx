import React, { useState } from 'react';
import { Infinity as InfinityIcon } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';

/** Kept out of the way on purpose: lifetime membership is granted rarely and only by committee decision. */
export default function LifetimeMembershipControl({ member, adminUser, onChanged }) {
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const action = member.lifetime ? 'remove' : 'grant';

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await apiFetch(apiUrl(`/api/admin/memberships/${encodeURIComponent(member.id)}/lifetime`), {
        method: 'POST', headers: { Authorization: `Bearer ${await adminUser.getIdToken(true)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, confirmation })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not change lifetime membership.');
      setMessage(action === 'grant' ? 'Now a lifetime membership.' : 'Lifetime membership removed; the previous expiry is restored.');
      setReason(''); setConfirmation('');
      await onChanged();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  return <details className="LifetimeControl SpaceT6">
    <summary>Advanced membership options</summary>
    <form className="SpaceT4" onSubmit={submit}>
      <h4 className="CartItemTitle"><InfinityIcon className="IconSm" /> Lifetime membership: {member.lifetime ? 'Yes' : 'No'}</h4>
      {member.lifetime
        ? <p className="text_container">Granted {member.lifetime.grantedAt ? new Date(member.lifetime.grantedAt).toLocaleDateString('en-GB') : ''} by {member.lifetime.grantedBy}: {member.lifetime.reason}</p>
        : <p className="text_container">Removes this membership's expiry for good. It stays active without renewing, is never sent renewal emails, and the JustGo sync no longer changes its expiry or status (a Paddle Scotland suspension still applies). Only for members the committee has agreed should be lifetime members.</p>}
      <label className="FormLabel">Reason (required)<textarea className="FormInput" required maxLength={1000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="FormLabel">Type the member ID <strong>{member.id}</strong> to confirm<input className="FormInput" value={confirmation} autoComplete="off" disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <button className="EditorCommand" disabled={busy || confirmation !== member.id || !reason.trim()}>{action === 'grant' ? 'Make lifetime member' : 'Remove lifetime membership'}</button>
      {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
      {message && <p className="StatusText StatusTextSuccess" role="status">{message}</p>}
    </form>
  </details>;
}
