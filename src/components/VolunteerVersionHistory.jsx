import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { apiUrl } from '../utils/api';

const CHANGES = { initial: 'Initial version', content: 'Page, list or form wording', levels: 'Volunteer levels', restore: 'Restore' };
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

/** Lists every saved volunteering version and restores one; a restore is itself saved as a new version, so it can be undone. */
export default function VolunteerVersionHistory({ adminUser, refreshKey, onRestored }) {
  const [versions, setVersions] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await fetch(apiUrl(path), { ...options, headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the version history.');
    return result;
  }, [adminUser]);
  const load = useCallback(() => request('/api/admin/volunteering/versions')
    .then((result) => setVersions(result.versions)).catch((loadError) => setError(loadError.message)), [request]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const restore = async (item) => {
    if (!window.confirm(`Restore version ${item.version} (${when(item.createdAt)}, ${item.editor})? This replaces the live page wording, ways to volunteer, form wording and volunteer levels. The current state stays in the history.`)) return;
    setBusy(item.version); setError(''); setMessage('');
    try {
      const result = await request(`/api/admin/volunteering/versions/${item.version}/restore`, { method: 'POST' });
      onRestored(result);
      setMessage(`Version ${item.version} restored and live as version ${result.version}.`);
      await load();
    } catch (restoreError) { setError(restoreError.message); }
    finally { setBusy(null); }
  };

  const latest = versions?.[0]?.version;
  return <div className="VolunteerConfigPanel">
    <p className="text_container_note">Every save of volunteering content or levels is kept as a version. Restoring brings back that version's page wording, ways to volunteer, form wording and levels, and is saved as a new version. A level still used by this or next year's volunteers is never removed by a restore.</p>
    {error && <p role="alert" className="StatusText StatusTextError">{error}</p>}
    {message && <p role="status" className="StatusText StatusTextSuccess">{message}</p>}
    {!versions && !error && <p role="status">Loading versions…</p>}
    <ol className="VolunteerVersionList">
      {versions?.map((item) => <li key={item.version} className="VolunteerVersionItem">
        <div>
          <strong>Version {item.version}</strong> · {when(item.createdAt)} · {item.editor}
          <div className="text_container_note">{item.change === 'restore' ? `Restored from version ${item.restoredFrom}` : CHANGES[item.change] || item.change}</div>
        </div>
        {item.version === latest ? <span className="text_container_note">Current</span>
          : <button type="button" className="EditorCommand" disabled={busy !== null} onClick={() => restore(item)}>
            <RotateCcw size={16} /> {busy === item.version ? 'Restoring…' : `Restore version ${item.version}`}
          </button>}
      </li>)}
    </ol>
  </div>;
}
