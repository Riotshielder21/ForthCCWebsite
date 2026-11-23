import React, { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import { clubYearLabel } from '../utils/clubYear';

const dayLabel = (millis) => new Date(millis).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

/** Renewal emails for next club year: who still needs one and a button to send them now rather than waiting for 1 February. */
export default function RenewalsPanel({ adminUser }) {
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const request = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await apiFetch(apiUrl(path), { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);

  const load = useCallback(() => request('/api/admin/renewals').then(setSummary).catch((loadError) => setError(loadError.message)), [request]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const payers = summary.subscriptions?.notEmailed || 0;
    if (!window.confirm(`Email a renewal link to ${summary.unsentContacts} contact address${summary.unsentContacts === 1 ? '' : 'es'}${payers ? `, including ${payers} subscription${payers === 1 ? '' : 's'} to confirm or cancel` : ''} now?`)) return;
    setError('');
    setMessage('');
    setSending(true);
    try {
      const result = await request('/api/admin/renewals/send', { method: 'POST', body: '{}' });
      const failures = (result.failures || 0) + (result.subscriptionFailures || 0);
      setMessage(`Sent ${result.emails} renewal email${result.emails === 1 ? '' : 's'} covering ${result.members} member${result.members === 1 ? '' : 's'}, and ${result.subscriptionEmails || 0} email${result.subscriptionEmails === 1 ? '' : 's'} about subscriptions only.${failures ? ` ${failures} could not be sent; try again later.` : ''}`);
      await load();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="main_tile SpaceT6">
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Membership</span><h3 className="tile_heading_bold_2">Renewal emails</h3></div></div>
      <p className="text_container SpaceB4">Website members whose membership ends this club year get one email per contact address with a link that fills the basket with next year's membership and the services they hold now. They can remove anything before paying. The same email has a separate green Confirm for volunteering again and for each subscription the address pays for (at the new club year's price from 1 March), a Confirm all, and a red Cancel for the subscriptions. Payers with nothing to renew get an email about just their subscriptions. Cancelling stops a subscription at the end of February; no answer means it carries on.</p>
      {summary && <p className="text_container SpaceB4">
        {summary.renewalYear && `For ${clubYearLabel(summary.renewalYear)}: `}{summary.members} member{summary.members === 1 ? '' : 's'} at {summary.contacts} contact address{summary.contacts === 1 ? '' : 'es'} still to renew; {summary.unsentContacts} not yet emailed.
        {' '}Emails are sent automatically on {dayLabel(summary.scheduledFrom)} to anyone not yet emailed, and a reminder on {dayLabel(summary.reminderFrom)} to anyone who still has not renewed. Links work until 31 March.
      </p>}
      {summary?.subscriptions && <p className="text_container SpaceB4">
        Subscriptions for {clubYearLabel(summary.subscriptions.renewalYear)}: {summary.subscriptions.confirmed} confirmed, {summary.subscriptions.unconfirmed} unconfirmed (carrying on), {summary.subscriptions.cancelled} cancelled; {summary.subscriptions.notEmailed} payer{summary.subscriptions.notEmailed === 1 ? '' : 's'} not yet emailed.
      </p>}
      {summary && !summary.open && <p className="text_container text_container_note">Staff can send renewal emails from {dayLabel(summary.opens)}.</p>}
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      <button className="FormSubmitButton" type="button" onClick={send} disabled={sending || !summary?.open || !(summary.unsentContacts || summary.subscriptions?.notEmailed)}><Mail className="IconMd" /> {sending ? 'Sending…' : 'Send renewal emails now'}</button>
      <p className="text_container text_container_note">To resend one member's email, open them in Reports.</p>
    </section>
  );
}
