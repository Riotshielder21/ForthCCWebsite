import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../utils/api';
import { ageOn, SWIMMING_LEVELS, DISCLAIMER_TEXT, PHOTO_CONSENT_TEXT } from '../utils/checkout';
import { loadEmailSession, clearEmailSession, sessionRequest } from '../utils/emailSession';
import EmailCodeSignIn from '../components/EmailCodeSignIn';
import { usePageEditor } from '../utils/PageContentContext';

const localTime = (value) => value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '';
const blankIdentity = { firstName: '', lastName: '', email: '', dob: '' };
const blankDetails = {
  phone: '', address: '', postcode: '', swimming: '', medical: '', photoConsent: false, disclaimerAccepted: false,
  emergencyContact: { name: '', relationship: '', phone: '' }, guardian: { name: '', relationship: '', phone: '', address: '', postcode: '' }
};
const membershipLabel = (checkin) => checkin.memberStatus || 'No';
const boatHireLabel = (checkin) => checkin.hasBoatHire ? 'Yes' : 'No';

function Field({ label, children }) {
  return <label className="FormLabel">{label}{children}</label>;
}

/** Admins signed in with Google use their ID token, so they skip the volunteer email code. */
const adminRequest = async (adminUser, path, { method = 'GET', body } = {}) => {
  const response = await fetch(apiUrl(path), {
    method, cache: 'no-store',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${await adminUser.getIdToken()}` },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Something went wrong. Please try again.'), { status: response.status, ...result });
  return result;
};

/** Large, thumb-sized session buttons, shown only when more than one session is on today. */
function SessionPicker({ label, sessions, value, onChange }) {
  return <fieldset className="CheckinsSessions">
    <legend className="FormLabel">{label}</legend>
    {sessions.map((session) => <button key={session.id} type="button" className="EditorCommand" aria-pressed={value === session.id}
      onClick={() => onChange(session.id)}>{session.name}<span className="CheckinsSessionTime">{session.start}–{session.end}</span></button>)}
  </fieldset>;
}

/** Ticked once someone has passed the self-assessment checklist; it carries forward until a volunteer unticks it with a reason. */
function SelfAssessment({ checkin, request, onChanged, onError }) {
  const [busy, setBusy] = useState(false);
  const change = async (passed) => {
    let note = '';
    if (!passed) {
      note = (window.prompt(`Why is ${checkin.name} not safe to go by themselves? For example, needs instruction or advice. This is recorded.`) || '').trim();
      if (note.length < 3) return onError('Add a short reason to untick the self-assessment.');
    }
    setBusy(true);
    try {
      const result = await request(`/api/club-night/checkins/${encodeURIComponent(checkin.id)}/self-assessment`, { method: 'POST', body: { passed, note } });
      onChanged(result.selfAssessment);
    } catch (changeError) { onError(changeError.message); } finally { setBusy(false); }
  };
  const { passed, note } = checkin.selfAssessment;
  return <div className="CheckinsSelfAssessment">
    <label><input type="checkbox" checked={passed} disabled={busy} onChange={(event) => change(event.target.checked)} /> Passed Self-Assessment / Safe</label>
    {passed && checkin.junior && <p className="StatusTextError">Under 18: check their buoyancy aid and that they are safe before they go by themselves.</p>}
    {!passed && note && <p className="text_container_note">Unticked: {note}</p>}
  </div>;
}

/** Attendee lists for events this person leads or was named on; admins see every event currently open. */
function EventAttendeeLists({ request, onEvents }) {
  const [events, setEvents] = useState([]);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    request('/api/event-rosters').then((result) => { setEvents(result.events); onEvents(result.events.length); })
      .catch((loadError) => { setEvents([]); onEvents(0); if (loadError.status !== 401) setError(loadError.message); });
  }, [request, onEvents]);
  const show = async (event) => {
    if (open?.event.id === event.id) return setOpen(null);
    setError('');
    try { setOpen(await request(`/api/event-rosters/${encodeURIComponent(event.id)}`)); } catch (showError) { setError(showError.message); }
  };
  if (!events.length && !error) return null;
  return <section className="SpaceY2">
    <h4 className="tile_heading_bold_2">Event attendee lists</h4>
    <p className="text_container_note">These lists contain medical and emergency details. Each view is recorded.</p>
    {error && <p className="StatusTextError" role="alert">{error}</p>}
    {events.map((event) => <div key={event.id}>
      <button className="EditorCommand CheckinsEventToggle" type="button" aria-expanded={open?.event.id === event.id} onClick={() => show(event)}>
        <span className="CheckinsEventDetails">
          <span className="CheckinsEventName">{event.name}</span>
          {event.schedule && <span className="CheckinsEventSchedule">{event.schedule}</span>}
        </span>
        <span className="CheckinsEventAction">{open?.event.id === event.id ? 'Hide attendees' : 'View attendees'}</span>
      </button>
      {open?.event.id === event.id && <>
        <p className="text_container" role="status">{open.attendees.length} booked</p>
        <ul className="CheckinsList" aria-label={`${event.name} attendees`}>
          {open.attendees.map((person, index) => <li className="CheckinsCard" key={`${person.name}-${index}`}>
            <h4 className="CheckinsName">{person.name}{person.kind === 'Under 18' ? ' (under 18)' : ''}</h4>
            <dl className="CheckinsFacts">
              <div><dt>Membership</dt><dd>{person.membership || 'No'}</dd></div>
              {person.nonMemberVisits && <div><dt>Non-member visits</dt><dd>{person.nonMemberVisits}</dd></div>}
              {typeof person.firstClubNight === 'boolean' && <div><dt>First club night</dt><dd>{person.firstClubNight ? 'Yes' : 'No'}</dd></div>}
              <div><dt>Kit</dt><dd>{person.kit}</dd></div>
              <div><dt>Swimming</dt><dd>{person.swimming || 'Not given'}</dd></div>
              <div><dt>Medical</dt><dd>{person.medical || 'None given'}</dd></div>
              <div><dt>Emergency contact</dt><dd>{person.emergencyContact || 'Not given'}</dd></div>
            </dl>
          </li>)}
        </ul>
        {!open.attendees.length && <p className="text_container">Nobody has booked yet.</p>}
      </>}
    </div>)}
  </section>;
}

function VolunteerPanel() {
  const { adminUser, authReady, login } = usePageEditor() || {};
  const [session, setSession] = useState(() => loadEmailSession('volunteer'));
  const request = useCallback((path, options) => adminUser
    ? adminRequest(adminUser, path, options) : sessionRequest('volunteer', path, options), [adminUser]);
  const signedInEmail = adminUser ? adminUser.email : session?.email;
  const [checkins, setCheckins] = useState([]);
  const [date, setDate] = useState('');
  const [contacts, setContacts] = useState({});
  const [accessEndsAt, setAccessEndsAt] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [current, setCurrent] = useState(null);
  const [chosen, setChosen] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notVolunteer, setNotVolunteer] = useState(false);
  const [eventCount, setEventCount] = useState(0);

  const load = useCallback(async () => {
    setError(''); setNotVolunteer(false); setLoading(true);
    try {
      const result = await request(`/api/club-night/checkins${chosen ? `?sessionId=${encodeURIComponent(chosen)}` : ''}`);
      setCheckins(result.checkins); setDate(result.date); setAccessEndsAt(result.accessEndsAt);
      setSessions(result.sessions || []); setCurrent(result.session || null);
    } catch (loadError) {
      if (loadError.sessionExpired) setSession(null);
      setCheckins([]); setContacts({}); setDate(''); setAccessEndsAt(0); setError(loadError.message);
      setNotVolunteer(loadError.status === 403 && !loadError.closed);
    } finally { setLoading(false); }
  }, [request, chosen]);

  useEffect(() => {
    if (!signedInEmail) return;
    load();
    const refresh = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [signedInEmail, load]);

  useEffect(() => {
    if (!accessEndsAt) return;
    const timer = setTimeout(() => {
      setCheckins([]); setContacts({}); setDate(''); setAccessEndsAt(0);
      setError('Access has ended. Refresh to check access or sign in again.');
    }, Math.max(0, accessEndsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [accessEndsAt]);

  const showContact = async (checkin) => {
    if (!window.confirm(`Only view ${checkin.name}'s emergency contact if it is needed. Each view is recorded.`)) return;
    try {
      const result = await request(`/api/club-night/checkins/${encodeURIComponent(checkin.id)}/emergency-contact`, { method: 'POST' });
      setContacts((current) => ({ ...current, [checkin.id]: result.contact || { missing: true } }));
    } catch (contactError) {
      if (contactError.sessionExpired || contactError.closed) {
        setCheckins([]); setContacts({}); setDate(''); setAccessEndsAt(0);
        if (contactError.sessionExpired) setSession(null);
      }
      setError(contactError.message);
    }
  };

  const adminSignIn = async () => {
    setError('');
    try { await login(); } catch (signInError) { setError(signInError.message || 'Google sign-in failed.'); }
  };

  const signOut = () => { clearEmailSession('volunteer'); setSession(null); setCheckins([]); setContacts({}); };

  return <section className="CheckinsVolunteer">
    <h3 className="tile_heading_bold_2">Volunteer view</h3>
    {!signedInEmail ? authReady === false ? <p className="text_container">Checking sign-in…</p> : <>
      <EmailCodeSignIn purpose="volunteer" buttonLabel="Email me a code" onVerified={setSession} intro="Sign in with your volunteer email." />
      {login && <button className="EditorCommand CheckinsAdminSignIn" type="button" onClick={adminSignIn}>Admin? Sign in with Google</button>}
      {error && <p className="StatusTextError" role="alert">{error}</p>}
    </>
      : <>
        <p className="text_container CheckinsIdentity">{signedInEmail}{adminUser ? ' (admin)' : ''}{date ? ` · ${date}` : ''}</p>
        <div className="CheckinsActions">
          <button className="EditorCommand" type="button" disabled={loading} onClick={load}>{loading ? 'Loading…' : 'Refresh check-ins'}</button>
          {!adminUser && <button className="EditorCommand" type="button" onClick={signOut}>Sign out</button>}
        </div>
        {error && !(notVolunteer && eventCount) && <p className="StatusTextError" role="alert">{error}</p>}
        <EventAttendeeLists request={request} onEvents={setEventCount} />
        {sessions.length > 1 && <SessionPicker label="Session" sessions={sessions} value={current?.id || ''} onChange={(id) => { setContacts({}); setChosen(id); }} />}
        {date && <>
          <p className="text_container" role="status">{checkins.length} checked in{current ? ` to ${current.name}` : ''} today</p>
          <ul className="CheckinsList" aria-label={`Today's ${current?.name || ''} check-ins`}>
            {checkins.map((checkin) => {
              const contact = contacts[checkin.id];
              return <li className="CheckinsCard" key={checkin.id}>
                <h4 className="CheckinsName">{checkin.name}{checkin.junior ? ' (under 18)' : ''}</h4>
                <dl className="CheckinsFacts">
                  <div><dt>Membership</dt><dd>{membershipLabel(checkin)}</dd></div>
                  {checkin.nonMemberVisits && <div><dt>Non-member visits</dt>
                    <dd className={checkin.nonMemberVisits.overLimit ? 'StatusTextError' : undefined}>{checkin.nonMemberVisits.label}</dd></div>}
                  {current?.subscriptions === true && <div><dt>Subscription</dt><dd>{checkin.subscription || 'No'}</dd></div>}
                  {current?.boatHire !== false && <div><dt>Boat hire</dt><dd>{boatHireLabel(checkin)}</dd></div>}
                  <div><dt>Attendance</dt><dd>{checkin.previouslyAttended ? 'Been before' : 'First visit'}</dd></div>
                  <div><dt>Checked in</dt><dd>{localTime(checkin.checkedInAt)}</dd></div>
                </dl>
                {current?.selfAssessment && checkin.selfAssessment && <SelfAssessment checkin={checkin} request={request} onError={setError}
                  onChanged={(selfAssessment) => setCheckins((list) => list.map((entry) => entry.id === checkin.id ? { ...entry, selfAssessment } : entry))} />}
                {contact ? <div className="CheckinsContact">{contact.missing ? 'No emergency contact recorded' : <>
                  <strong>{contact.name}</strong> ({contact.relationship})<br />
                  <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}>{contact.phone}</a>
                </>}</div> : checkin.canShowEmergencyContact && <button className="EditorCommand CheckinsContactButton" type="button"
                  aria-label={`Show emergency contact for ${checkin.name}`} onClick={() => showContact(checkin)}>Show emergency contact</button>}
              </li>;
            })}
          </ul>
          {!checkins.length && <p className="text_container">No check-ins yet today.</p>}
        </>}
      </>}
  </section>;
}

export default function ClubNightPage() {
  const [club, setClub] = useState(null);
  const [view, setView] = useState(() => loadEmailSession('volunteer') ? 'volunteer' : 'checkin');
  const [identity, setIdentity] = useState(blankIdentity);
  const [details, setDetails] = useState(blankDetails);
  const [needsDetails, setNeedsDetails] = useState(false);
  const [status, setStatus] = useState('');
  const [checkedIn, setCheckedIn] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const checkinFocus = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    checkinFocus.current?.focus();
  }, [checkedIn]);

  useEffect(() => {
    let active = true;
    const loadClub = async () => {
      try {
        const response = await fetch(apiUrl('/api/club-night'), { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load check-in availability.');
        if (active) setClub(result);
      } catch (loadError) {
        if (active) setClub({ open: false, message: loadError.message });
      }
    };
    loadClub();
    const refresh = () => { if (!document.hidden) loadClub(); };
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    if (!club?.open || !club.dayEndsAt) return;
    const timer = setTimeout(() => setClub((current) => ({ ...current, open: false, message: 'Check-in has closed for today.' })),
      Math.max(0, club.dayEndsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [club?.open, club?.dayEndsAt]);

  const todaysSessions = club?.open ? club.sessions || [] : [];
  const session = todaysSessions.length === 1 ? todaysSessions[0] : todaysSessions.find((entry) => entry.id === sessionId);
  const junior = (ageOn(identity.dob) ?? 99) < 18;
  const setId = (field) => (event) => { setIdentity({ ...identity, [field]: event.target.value }); setNeedsDetails(false); };
  const setDetail = (field) => (event) => setDetails({ ...details, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const setNested = (group, field) => (event) => setDetails({ ...details, [group]: { ...details[group], [field]: event.target.value } });

  const submit = async (event) => {
    event.preventDefault();
    if (!session) { setError('Choose which session you are checking in to.'); return; }
    setBusy(true); setError(''); setStatus('');
    try {
      const response = await fetch(apiUrl('/api/club-night/checkins'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ ...identity, sessionId: session.id, ...(needsDetails ? { details } : {}) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not record check-in.');
      if (result.needsDetails) { setNeedsDetails(true); setStatus(result.message); return; }
      setIdentity(blankIdentity); setDetails(blankDetails); setNeedsDetails(false);
      setStatus(result.message);
      setCheckedIn(true);
    } catch (submitError) { setError(submitError.message); }
    finally { setBusy(false); }
  };

  return <div className="SectionContent CheckinsPage PageFadeIn">
    <h2 className="page_heading_bold_1">Check-ins</h2>
    <p className="CartItemMeta">{session?.name || (todaysSessions.length > 1 ? 'Choose your session' : 'Club night')}</p>
    <div className="CheckinsTabs" role="group" aria-label="Check-in views">
      <button className="EditorCommand" type="button" aria-pressed={view === 'checkin'} onClick={() => setView('checkin')}>Check in</button>
      <button className="EditorCommand" type="button" aria-pressed={view === 'volunteer'} onClick={() => setView('volunteer')}>Volunteer view</button>
    </div>
    <div hidden={view !== 'checkin'}>
    {club && !club.open && <p className="text_container" role="status">{club.message}</p>}
    {checkedIn ? <section className="FormContainer FormBody">
      <h3 className="tile_heading_bold_2" ref={checkinFocus} tabIndex={-1}>Thank you!</h3>
      <p role="status">{status}</p>
      {club?.open && <button className="FormSubmitButton" type="button" onClick={() => {
        setStatus(''); setError(''); setCheckedIn(false);
      }}>Check in another person</button>}
    </section> : club?.open && <>
      {todaysSessions.length > 1 && <SessionPicker label="Which session are you here for?" sessions={todaysSessions} value={session?.id || ''}
        onChange={(id) => { setSessionId(id); setError(''); }} />}
      <p className="text_container">Use your membership email, or a parent/guardian's email for under-18s.</p>
      <form className="FormContainer FormBody" onSubmit={submit}>
        <Field label="First name"><input ref={checkinFocus} className="FormInput" autoComplete="given-name" maxLength="80" required value={identity.firstName} onChange={setId('firstName')} /></Field>
        <Field label="Last name"><input className="FormInput" autoComplete="family-name" maxLength="80" required value={identity.lastName} onChange={setId('lastName')} /></Field>
        <Field label="Date of birth"><input className="FormInput" type="date" autoComplete="bday" required value={identity.dob} onChange={setId('dob')} /></Field>
        <Field label="Email address"><input className="FormInput" type="email" autoComplete="email" maxLength="254" required value={identity.email} onChange={setId('email')} /></Field>
        {needsDetails && <fieldset className="SpaceT4">
          <legend className="tile_heading_bold_2">Your details</legend>
          <p className="text_container">This is just to register your attendance.</p>
          {junior ? <>
            <Field label="Parent/guardian name"><input className="FormInput" maxLength="120" required value={details.guardian.name} onChange={setNested('guardian', 'name')} /></Field>
            <Field label="Relationship"><input className="FormInput" maxLength="60" required value={details.guardian.relationship} onChange={setNested('guardian', 'relationship')} /></Field>
            <Field label="Parent/guardian phone"><input className="FormInput" type="tel" maxLength="40" required value={details.guardian.phone} onChange={setNested('guardian', 'phone')} /></Field>
            <Field label="Address"><input className="FormInput" maxLength="300" required value={details.guardian.address} onChange={setNested('guardian', 'address')} /></Field>
            <Field label="Postcode"><input className="FormInput" maxLength="12" required value={details.guardian.postcode} onChange={setNested('guardian', 'postcode')} /></Field>
          </> : <>
            <Field label="Phone"><input className="FormInput" type="tel" autoComplete="tel" maxLength="40" required value={details.phone} onChange={setDetail('phone')} /></Field>
            <Field label="Address"><input className="FormInput" autoComplete="street-address" maxLength="300" required value={details.address} onChange={setDetail('address')} /></Field>
            <Field label="Postcode"><input className="FormInput" autoComplete="postal-code" maxLength="12" required value={details.postcode} onChange={setDetail('postcode')} /></Field>
            <Field label="Emergency contact name"><input className="FormInput" maxLength="120" required value={details.emergencyContact.name} onChange={setNested('emergencyContact', 'name')} /></Field>
            <Field label="Emergency contact relationship"><input className="FormInput" maxLength="60" required value={details.emergencyContact.relationship} onChange={setNested('emergencyContact', 'relationship')} /></Field>
            <Field label="Emergency contact phone"><input className="FormInput" type="tel" maxLength="40" required value={details.emergencyContact.phone} onChange={setNested('emergencyContact', 'phone')} /></Field>
          </>}
          <Field label="Swimming ability">
            <select className="FormInput" required value={details.swimming} onChange={setDetail('swimming')}>
              <option value="">Choose…</option>
              {SWIMMING_LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Medical or other information we should know (optional)"><textarea className="FormInput" maxLength="1000" value={details.medical} onChange={setDetail('medical')} /></Field>
          <label className="CheckoutCheck"><input type="checkbox" checked={details.photoConsent} onChange={setDetail('photoConsent')} /> {PHOTO_CONSENT_TEXT}</label>
          <label className="CheckoutCheck"><input type="checkbox" required checked={details.disclaimerAccepted} onChange={setDetail('disclaimerAccepted')} /> {DISCLAIMER_TEXT}</label>
        </fieldset>}
        {error && <p className="StatusTextError" role="alert">{error}</p>}
        {status && <p role="status">{status}</p>}
        <button className="FormSubmitButton" type="submit" disabled={busy}>{needsDetails ? 'Save details and check in' : 'Check in'}</button>
      </form>
    </>}
    </div>
    {view === 'volunteer' && <VolunteerPanel />}
  </div>;
}
