import React, { useState } from 'react';
import { Send, CheckCircle, AlertCircle } from 'lucide-react';
import { apiUrl } from '../utils/api';
import { volunteerBenefitText } from '../utils/volunteering';

export default function VolunteerForm({ tiers, products = [], renewal = null, token = '', title = 'Volunteer sign-up', description = '' }) {
  const [name, setName] = useState(renewal?.name || '');
  const [email, setEmail] = useState(renewal?.email || '');
  const [tier, setTier] = useState(renewal?.change ? '' : renewal?.tier || '');
  const [activities, setActivities] = useState('');
  const [availability, setAvailability] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const chosen = tiers.find((candidate) => candidate.id === tier);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setStatus(null);
    try {
      const response = await fetch(apiUrl(token ? `/api/volunteers/renew/${token}` : '/api/lists'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, tier, notes, listType: 'Volunteer Sign-ups',
          items: [`Activities: ${activities}`, `Availability: ${availability}`] })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save your volunteering.');
      setStatus({ type: 'success', message: token ? 'Your volunteering and benefits are confirmed for next club year.'
        : 'Thank you for volunteering! We will be in touch about an induction. Your benefits are added to your membership once you are inducted.' });
    } catch (error) { setStatus({ type: 'error', message: error.message }); }
    finally { setBusy(false); }
  };
  return <div className="FormContainer">
    <div className="SpaceB8">
      <h2 className="form_heading_bold">{renewal ? `Volunteer again for ${renewal.year}/${renewal.year + 1}` : title}</h2>
      {description && <p className="FormDescription">{description}</p>}
    </div>
    <form onSubmit={submit} className="FormBody">
      <div className="FormFieldGrid">
        <div>
          <label className="FormLabel">Your Name *</label>
          <input type="text" required maxLength="120" value={name} disabled={Boolean(renewal)} onChange={(event) => setName(event.target.value)} className="FormInput" placeholder="John Doe" />
        </div>
        <div>
          <label className="FormLabel">Email Address *</label>
          <input type="email" required maxLength="254" value={email} disabled={Boolean(renewal)} onChange={(event) => setEmail(event.target.value)} className="FormInput" placeholder="john@example.com" />
        </div>
      </div>
      <div>
        <label className="FormLabel">Hours per club year *</label>
        <select required value={tier} onChange={(event) => setTier(event.target.value)} className="FormInput">
          <option value="">Select...</option>
          {tiers.map((option) => <option key={option.id} value={option.id}>{option.hours}+ hours{option.title ? ` — ${option.title}` : ''}</option>)}
        </select>
        {chosen && <p className="FormDescription SpaceT2">{volunteerBenefitText(chosen, products)}</p>}
      </div>
      {!renewal && <>
        <div>
          <label className="FormLabel">Which activities would you like to help with? *</label>
          <textarea rows={3} required maxLength="400" value={activities} onChange={(event) => setActivities(event.target.value)} className="FormInput" placeholder="e.g. coaching, events, maintenance, fundraising" />
        </div>
        <div>
          <label className="FormLabel">When are you available? *</label>
          <input type="text" required maxLength="400" value={availability} onChange={(event) => setAvailability(event.target.value)} className="FormInput" placeholder="e.g. Thursday evenings" />
        </div>
        <div>
          <label className="FormLabel">Additional Notes</label>
          <textarea rows={3} maxLength="1000" value={notes} onChange={(event) => setNotes(event.target.value)} className="FormInput" placeholder="Any additional information..." />
        </div>
      </>}
      {status && <div className={`FormAlert ${status.type === 'success' ? 'AlertSuccess' : 'AlertError'}`} role={status.type === 'error' ? 'alert' : 'status'}>
        <div className="FormAlertInner">
          {status.type === 'success' ? <CheckCircle className="IconLg FormAlertIcon" /> : <AlertCircle className="IconLg FormAlertIcon" />}
          <div className="FormAlertBody"><p className="FormAlertMessage">{status.message}</p></div>
        </div>
      </div>}
      <button type="submit" disabled={busy || !tiers.length} className="FormSubmitButton">
        {busy ? <><div className="FormSpinner" />Submitting...</> : <><Send className="IconMd" />{renewal ? 'Confirm volunteering for next year' : 'Submit'}</>}
      </button>
    </form>
  </div>;
}
