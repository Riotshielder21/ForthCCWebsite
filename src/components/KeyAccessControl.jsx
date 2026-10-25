import React, { useState } from 'react';
import { apiUrl } from '../utils/api';

export default function KeyAccessControl({ member, adminUser, onChanged }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const action = member.keyAccess === 'Granted' ? 'revoke' : 'grant';
  const submit = async (event) => {
    event.preventDefault();
    if (!window.confirm(`${action === 'revoke' ? 'Revoke key access and stop future code emails for' : 'Grant key access and email the current codes to'} ${member.name}?`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(apiUrl(`/api/admin/memberships/${encodeURIComponent(member.id)}/key-access`), {
        method: 'POST', headers: { Authorization: `Bearer ${await adminUser.getIdToken(true)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not change key access.');
      setMessage(result.delivery === 'not-sent' ? 'Access granted, but codes could not be emailed. Save the boathouse codes again to retry.' : `Key access ${action === 'grant' ? 'granted' : 'revoked'}.`);
      setReason('');
      await onChanged();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <form className="SpaceT4" onSubmit={submit}>
    <h4 className="CartItemTitle">Key access: {member.keyAccess}</h4>
    {member.keyAccessReason && <p className="text_container">Last reason: {member.keyAccessReason}</p>}
    <p className="text_container">An admin revocation stops code emails even if this member buys key hire or is an inducted volunteer. It does not change payments. Rotate the codes to stop someone who already knows them.</p>
    <label className="FormLabel">Reason (required)<textarea className="FormInput" required maxLength={1000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
    <button className="EditorCommand" disabled={busy}>{action === 'grant' ? 'Grant / restore key access' : 'Revoke key access'}</button>
    {error && <p className="StatusText StatusTextError" role="alert">{error}</p>}
    {message && <p className="StatusText StatusTextSuccess" role="status">{message}</p>}
  </form>;
}
