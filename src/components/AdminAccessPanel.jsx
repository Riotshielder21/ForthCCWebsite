import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UserMinus } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { ADMIN_DOMAIN } from '../utils/adminAccess';

/** Existing admins approve or remove other club Google accounts as website admins. */
export default function AdminAccessPanel({ adminUser }) {
  const [admins, setAdmins] = useState([]);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl('/api/admin/admins'), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);

  const load = useCallback(() => request().then((result) => setAdmins(result.admins)).catch((loadError) => setError(loadError.message)), [request]);
  useEffect(() => { load(); }, [load]);

  const change = async (action, target) => {
    const prompt = action === 'grant'
      ? `Make ${target} a website admin? They will be able to see member data, cancel subscriptions, erase records and change the boathouse code.`
      : `Remove admin access from ${target}? They will be signed out.`;
    if (!window.confirm(prompt)) return;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await request({ method: 'POST', body: JSON.stringify({ action, email: target }) });
      setMessage(action === 'grant' ? `${target} is now an admin. They need to sign out and in again.` : `${target} is no longer an admin.`);
      if (action === 'grant') setEmail('');
      await load();
    } catch (changeError) {
      setError(changeError.message);
    } finally {
      setBusy(false);
    }
  };

  const self = adminUser.email?.toLowerCase();
  return (
    <form className="main_tile SpaceT6" onSubmit={(event) => { event.preventDefault(); change('grant', email.trim().toLowerCase()); }}>
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Access</span><h3 className="tile_heading_bold_2">Website admins</h3></div></div>
      <p className="text_container SpaceB4">Admins can see member data, cancel subscriptions, erase records and change the boathouse code. To add someone, ask them to sign in once at /admin with their @{ADMIN_DOMAIN} Google account, then approve them here.</p>
      <ul className="SpaceB4">
        {admins.map((admin) => (
          <li key={admin.uid} className="AdminListHeader">
            <span>{admin.email}{admin.name ? ` (${admin.name})` : ''}{admin.lastSignIn ? ` · last signed in ${new Date(admin.lastSignIn).toLocaleDateString('en-GB')}` : ''}</span>
            {admin.email.toLowerCase() !== self && <button type="button" className="EditorCommand" disabled={busy} onClick={() => change('revoke', admin.email)}><UserMinus className="IconMd" /> Remove</button>}
          </li>
        ))}
      </ul>
      <label className="FormLabel">Club email<input className="FormInput" type="email" required autoComplete="off" placeholder={`name@${ADMIN_DOMAIN}`} value={email}
        onChange={(event) => setEmail(event.target.value)} /></label>
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      <button className="FormSubmitButton" type="submit" disabled={busy}><ShieldCheck className="IconMd" /> Approve admin</button>
    </form>
  );
}
