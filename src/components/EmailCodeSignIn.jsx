import React, { useState } from 'react';
import { apiUrl } from '../utils/api';
import { saveEmailSession } from '../utils/emailSession';

const post = async (path, body) => {
  const response = await fetch(apiUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
    .catch(() => { throw new Error('Could not reach the club website. Check your connection and try again.'); });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
};

/** Two steps: send a 6-digit code to an email address, then enter it to start a short session for `purpose`. `askDob` also sends a date of birth. */
export default function EmailCodeSignIn({ purpose, intro, buttonLabel = 'Email me a code', askDob = false, onVerified }) {
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = (action) => async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await action(); } catch (actionError) { setError(actionError.message); } finally { setBusy(false); }
  };

  const requestCode = run(async () => {
    const result = await post('/api/email-codes', { email, purpose, ...(askDob ? { dob } : {}) });
    setSent(true); setCode(''); setMessage(result.message);
  });

  const verify = run(async () => {
    const result = await post('/api/email-codes/verify', { email, purpose, code, ...(askDob ? { dob } : {}) });
    const session = { token: result.token, email: result.email, expiresAt: result.expiresAt };
    saveEmailSession(purpose, session);
    onVerified(session);
  });

  return <div className="FormContainer FormBody">
    {intro && <p className="text_container">{intro}</p>}
    {!sent ? <form onSubmit={requestCode}>
      <label className="FormLabel">Email address
        <input className="FormInput" type="email" autoComplete="email" maxLength="254" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {askDob && <label className="FormLabel">Your date of birth, or the attendee's
        <input className="FormInput" type="date" autoComplete="bday" required value={dob} onChange={(event) => setDob(event.target.value)} />
      </label>}
      {error && <p className="StatusTextError" role="alert">{error}</p>}
      <button className="FormSubmitButton" type="submit" disabled={busy}>{buttonLabel}</button>
    </form> : <form onSubmit={verify}>
      <p role="status">{message}</p>
      <label className="FormLabel">6-digit code
        <input className="FormInput" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
      </label>
      {error && <p className="StatusTextError" role="alert">{error}</p>}
      <div className="SpaceY2">
        <button className="FormSubmitButton" type="submit" disabled={busy}>Confirm code</button>
        <button className="EditorCommand" type="button" disabled={busy} onClick={() => { setSent(false); setMessage(''); setError(''); }}>{askDob ? 'Change details or resend' : 'Use a different email or resend'}</button>
      </div>
    </form>}
  </div>;
}
