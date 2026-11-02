import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Check } from 'lucide-react';
import { apiUrl } from '../utils/api';

const when = (value) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';

/** Payment and subscription problems the website could not sort out by itself, newest first. */
export default function NeedsAttentionPanel({ adminUser, onOpenRecord }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(true);

  const request = useCallback(async (path, method = 'GET', body) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl(path), { method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The request did not complete.');
    return result;
  }, [adminUser]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setEntries((await request('/api/admin/attention')).entries || []); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { load(); }, [load]);

  const retry = async (entry) => {
    setBusy(entry.id);
    setError('');
    setMessage('');
    try {
      const result = await request(`/api/admin/attention/${encodeURIComponent(entry.id)}/retry`, 'POST', {});
      setMessage(result.message);
      await load();
    } catch (retryError) {
      setError(retryError.message);
      await load();
    } finally { setBusy(''); }
  };
  const resolve = async (event) => {
    event.preventDefault();
    setBusy(resolving.id);
    setError('');
    try {
      await request(`/api/admin/attention/${encodeURIComponent(resolving.id)}/resolve`, 'POST', { note });
      setResolving(null);
      setNote('');
      setMessage('Marked resolved.');
      await load();
    } catch (resolveError) { setError(resolveError.message); }
    finally { setBusy(''); }
  };

  return <section className="NeedsAttention" aria-labelledby="needs-attention-heading">
    <header className="NeedsAttentionHeader">
      <button type="button" className="NeedsAttentionToggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <AlertTriangle size={20} /> <h3 id="needs-attention-heading">Needs attention ({loading ? 'checking' : error ? 'unavailable' : entries.length})</h3>
      </button>
      <button type="button" className="EditorIconButton" title="Refresh" aria-label="Refresh needs attention" disabled={loading} onClick={load}><RefreshCw size={18} /></button>
    </header>
    {message && <p className="StatusTextSuccess" role="status">{message}</p>}
    {error && <p className="StatusTextError" role="alert">{error}</p>}
    {open && loading && <p role="status">Checking for alerts...</p>}
    {open && !loading && !error && !entries.length && <p className="StatusTextSuccess" role="status">Nothing needs attention.</p>}
    {open && entries.length > 0 && <ul className="NeedsAttentionList">
      {entries.map((entry) => <li key={entry.id} className="NeedsAttentionItem">
        <div>
          <strong>{entry.title}</strong>{entry.occurrences > 1 && <span className="ReportWarning">seen {entry.occurrences} times</span>}
          <p>{entry.detail}</p>
          <p className="NeedsAttentionMeta">{when(entry.createdAt)}
            {entry.orderRef && <> · Order {onOpenRecord ? <button type="button" className="ContentLink" onClick={() => onOpenRecord('orders', entry.orderRef)}>{entry.orderRef}</button> : entry.orderRef}</>}
            {entry.subscriptionId && <> · {entry.subscriptionId}</>}
            {entry.email && <> · {entry.email}</>}</p>
        </div>
        {resolving?.id === entry.id
          ? <form className="NeedsAttentionResolve" onSubmit={resolve}>
            <label className="FormLabel">What was done<input className="FormInput" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} required autoFocus /></label>
            <button className="EditorCommand" type="submit" disabled={busy === entry.id}><Check size={18} /> Mark resolved</button>
            <button className="EditorCommand" type="button" onClick={() => setResolving(null)}>Cancel</button>
          </form>
          : <div className="ReportsRowActions">
            {entry.retry && <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={() => retry(entry)}><RotateCcw size={18} /> {busy === entry.id ? 'Retrying…' : 'Retry'}</button>}
            <button className="EditorCommand" type="button" disabled={Boolean(busy)} onClick={() => { setResolving(entry); setNote(''); }}><Check size={18} /> Resolve…</button>
          </div>}
      </li>)}
    </ul>}
  </section>;
}
