import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Search, Trash2, X, ArrowLeft, FileText, Mail, Users, ShoppingBag, AlertTriangle, CalendarClock } from 'lucide-react';
import { usePageEditor } from '../utils/PageContentContext';
import { apiUrl } from '../utils/api';
import { reportCsv, uniqueReportEmails, eventAttendeeHeaders, eventAttendeeRows, justgoUploadHeaders, justgoUploadRows } from '../utils/adminReports';
import { eventScheduleLabel } from '../utils/catalogue';
import CustomerVouchers from '../components/CustomerVouchers';

const detailValue = (value) => {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return 'Not recorded';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return new Date(value).toLocaleString('en-GB');
  return String(value);
};
const dateLabel = (date) => date ? new Date(date).toLocaleDateString('en-GB') : 'Unknown';
const money = (amount) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
const download = (name, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function AdminReportsPage({ onNavigate }) {
  const { adminUser, authReady } = usePageEditor();
  const [kind, setKind] = useState('subscribers');
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Active');
  const [checkedAt, setCheckedAt] = useState(null);
  const [stripeMode, setStripeMode] = useState('');
  const [clubYearEnd, setClubYearEnd] = useState(null);
  const [scheduleConfirmation, setScheduleConfirmation] = useState('');
  const [scheduleAcknowledged, setScheduleAcknowledged] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [purchaseType, setPurchaseType] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [stripeRequired, setStripeRequired] = useState(false);
  const [stripeAcknowledged, setStripeAcknowledged] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const generation = useRef(0);
  const closeButton = useRef(null);
  const returnFocus = useRef(null);
  const purchaseReport = kind === 'orders' || kind === 'events';

  const load = async (nextCursor = null) => {
    const revision = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const token = await adminUser.getIdToken(true);
      if (generation.current !== revision) return;
      const params = new URLSearchParams({ kind });
      if (nextCursor) params.set('cursor', nextCursor);
      const response = await fetch(apiUrl(`/api/admin/reports?${params}`), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load report.');
      if (generation.current !== revision) return;
      setRecords((current) => nextCursor ? [...current, ...result.records.filter((record) => !current.some((item) => item.id === record.id))] : result.records);
      setCursor(result.nextCursor);
      setCheckedAt(result.checkedAt || null);
      setStripeMode(result.mode || '');
      setClubYearEnd(result.clubYearEnd || null);
    } catch (loadError) {
      if (generation.current === revision) setError(loadError.message);
    } finally {
      if (generation.current === revision) setLoading(false);
    }
  };

  useEffect(() => {
    setRecords([]);
    setCursor(null);
    setCheckedAt(null);
    setStripeMode('');
    setClubYearEnd(null);
    if (adminUser) load();
    return () => { generation.current += 1; };
  }, [kind, adminUser]);

  useEffect(() => {
    if (!selected && !deleting) return undefined;
    returnFocus.current = document.activeElement;
    closeButton.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape' && !deleteBusy && !scheduleBusy) { setSelected(null); setDeleting(null); }
      if (event.key === 'Tab') {
        const dialog = closeButton.current?.closest('[role="dialog"]');
        const controls = [...(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]') || [])];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); returnFocus.current?.focus(); };
  }, [selected, deleting, deleteBusy, scheduleBusy]);

  useEffect(() => {
    setScheduleConfirmation('');
    setScheduleAcknowledged(false);
  }, [selected?.id]);

  const filtered = records.filter((record) => {
    const haystack = `${record.id} ${record.clubCustomerId || ''} ${record.clubSubscriptionId || ''} ${record.email || ''} ${record.name || ''} ${record.scaId || ''} ${record.phone || ''} ${record.address || ''} ${record.emergencyContact || ''} ${record.parent || ''} ${record.tier || ''} ${(record.privileges || []).join(' ')} ${(record.items || []).map((item) => item.name).join(' ')}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (status === 'all' || record.status === status)
      && (kind !== 'members' || ((sourceFilter === 'all' || record.justgo === sourceFilter) && (tierFilter === 'all' || record.tier === tierFilter)))
      && (kind !== 'orders' || purchaseType === 'all'
        || (purchaseType === 'membership' && record.items.some((item) => item.category === 'MEMBERSHIP'))
        || (purchaseType === 'subscriptions' && record.subscriptionWarning));
  });
  const emails = uniqueReportEmails(filtered);
  const justgoAction = async (id, action) => {
    setError('');
    try {
      const token = await adminUser.getIdToken(true);
      const response = await fetch(apiUrl(`/api/admin/memberships/${encodeURIComponent(id)}/justgo`), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update JustGo status.');
      setSelected(null);
      setMessage(action === 'retry' ? 'Queued for another automatic JustGo upload.' : 'Marked as added to JustGo by staff. The next sync will link them.');
      load();
    } catch (actionError) {
      setError(actionError.message);
    }
  };

  const exportRecords = () => {
    if (kind === 'events') {
      download(`fcc-event-attendees-${new Date().toISOString().slice(0, 10)}.csv`, reportCsv(eventAttendeeHeaders, eventAttendeeRows(filtered, eventScheduleLabel)));
      return;
    }
    const headers = purchaseReport
      ? ['Order ID', 'Email', 'Status', 'Created', 'Paid', kind === 'events' ? 'Event tickets total GBP' : 'Total GBP', 'Items and schedules', 'Stripe subscription ID', 'Stripe check required']
      : kind === 'subscribers' ? ['Subscription ID', 'Customer ID', 'Club customer ID', 'Club subscription ID', 'Name', 'Email', 'Eligibility', 'Stripe status', 'Reason', 'Plans', 'Period end', 'Cancellation date', 'Payment reversed', 'Refund check available', 'Checked at', 'Stripe mode']
      : ['Membership ID', 'Name', 'Date of birth', 'Email', 'Phone', 'Address', 'JustGo ID', 'Tier', 'Status', 'Valid until', 'Includes', 'Emergency contact', 'Parent or guardian', 'Medical', 'Swimming', 'Photo consent', 'JustGo', 'Renews via', 'Last updated'];
    const rows = filtered.map((record) => purchaseReport
      ? [record.id, record.email, record.status, record.createdAt, record.paidAt, record.total,
        record.items.map((item) => `${item.name}${item.price === null ? '' : ` (${money(item.price)})`}${item.eventSchedule ? ` — ${eventScheduleLabel(item.eventSchedule)}` : ''}`).join('; '), record.stripeSubscriptionId, record.subscriptionWarning ? 'Yes' : 'No']
      : kind === 'subscribers' ? [record.id, record.stripeCustomerId, record.clubCustomerId, record.clubSubscriptionId, record.name, record.email, record.status, record.stripeStatus, record.reason,
        record.items.map((item) => `${item.name}: ${item.amount ?? 'variable'} ${item.currency.toUpperCase()}/${item.interval}`).join('; '),
        record.currentPeriodEnd, record.cancelAt, record.paymentReversed ? 'Yes' : 'No', record.refundCheckAvailable ? 'Yes' : 'No', checkedAt, stripeMode]
      : [record.id, record.name, record.dob, record.email, record.phone, record.address, record.scaId, record.tier, record.status, record.expiry, record.privileges.join('; '), record.emergencyContact, record.parent, record.medical, record.swimming, record.photoConsent ? 'Yes' : 'No', record.justgo, record.renewalMethod, record.lastUpdated]);
    download(`fcc-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, reportCsv(headers, rows));
  };
  const beginDelete = (record) => {
    setSelected(null);
    setDeleting(record);
    setConfirmation('');
    setStripeRequired(kind === 'members' || record.subscriptionWarning);
    setStripeAcknowledged(false);
    setMessage('');
    setError('');
  };
  const scheduleCancellation = async () => {
    setScheduleBusy(true);
    setError('');
    try {
      const token = await adminUser.getIdToken(true);
      const response = await fetch(apiUrl(`/api/admin/subscribers/${encodeURIComponent(selected.id)}/club-year-cancellation`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: stripeMode, clubCustomerId: selected.clubCustomerId,
          confirmId: scheduleConfirmation, clubYearEnd, acknowledgeBillingChange: scheduleAcknowledged })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not confirm the Stripe cancellation schedule.');
      setRecords((current) => current.map((record) => record.id === result.record.id ? result.record : record));
      setSelected(result.record);
      setMessage(`${result.changed ? 'Stripe cancellation scheduled' : 'Earlier Stripe cancellation preserved'} for ${dateLabel(result.cancellationAt)}. A fresh purchase is needed for the following club year.`);
    } catch (scheduleError) {
      setError(scheduleError.message);
    } finally {
      setScheduleBusy(false);
    }
  };
  const deleteRecord = async () => {
    setDeleteBusy(true);
    setError('');
    try {
      const token = await adminUser.getIdToken(true);
      const response = await fetch(apiUrl(`/api/admin/records/${kind}/${encodeURIComponent(deleting.id)}`), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmId: confirmation, acknowledgeStripe: stripeAcknowledged })
      });
      const result = await response.json();
      if (result.requiresStripeAcknowledgement) setStripeRequired(true);
      if (!response.ok) throw new Error(result.error || 'Could not delete record.');
      setRecords((current) => current.filter((record) => record.id !== deleting.id));
      setMessage(`Record ${deleting.id} deleted. Stripe payments and other records were not changed.`);
      setDeleting(null);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!authReady) return <p className="SectionHero" role="status">Restoring your session…</p>;
  if (!adminUser) return <div className="SectionHero"><h2 className="tile_heading_bold_1">Admin reports</h2><button className="PrimaryActionButton" onClick={() => onNavigate('admin')}>Admin login</button></div>;
  return <div className="AdminReports PageFadeIn">
    <header className="ReportsHeader"><div><h2 className="tile_heading_bold_1">Reports & records</h2><span className="text_container">{records.length} loaded records{cursor ? ' (more available)' : ''}</span></div>
      <button className="EditorCommand" onClick={() => onNavigate('admin')}><ArrowLeft size={18} /> Website editor</button>
    </header>
    <div className="ReportsTabs" role="tablist" aria-label="Report type">
      {[[Users, 'subscribers', 'Stripe subscribers'], [ShoppingBag, 'orders', 'Purchases'], [CalendarClock, 'events', 'Event tickets'], [Users, 'members', 'Member register']].map(([Icon, id, label]) => <button key={id} role="tab" disabled={scheduleBusy} aria-selected={kind === id} className={kind === id ? 'is-selected' : ''} onClick={() => {
        if (id === kind) return;
        generation.current += 1;
        setRecords([]);
        setCursor(null);
        setLoading(true);
        setCheckedAt(null); setStripeMode(''); setClubYearEnd(null);
        setKind(id); setSourceFilter('all'); setTierFilter('all'); setStatus(id === 'members' ? 'Current' : id === 'subscribers' ? 'Active' : 'all'); setPurchaseType('all'); setSearch(''); setMessage('');
      }}><Icon size={18} /> {label}</button>)}
    </div>
    <div className="ReportsFilters">
      <label className="ReportsSearch"><Search size={18} /><input aria-label="Search report" placeholder={purchaseReport ? 'Email, order, or product' : 'Name, email, or member ID'} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{(kind === 'subscribers' ? ['Active', 'Inactive'] : purchaseReport ? ['paid', 'pending', 'failed', 'cancelled'] : ['Current', 'Expired', 'Unverified expiry', ...new Set(records.map((record) => record.status).filter((value) => !['Current', 'Expired', 'Unverified expiry'].includes(value)))]).map((value) => <option key={value}>{value}</option>)}</select></label>
      {kind === 'members' && <><label>JustGo<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">All members</option>{['Awaiting upload', 'Invitation sent', 'Needs staff upload', 'Added by staff, awaiting sync', 'In JustGo', 'Not in JustGo'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Tier<select value={tierFilter} onChange={(event) => setTierFilter(event.target.value)}><option value="all">All tiers</option>{['adult', 'junior', 'family'].map((tier) => <option key={tier}>{tier}</option>)}</select></label></>}
      {kind === 'orders' && <label>Purchase<select value={purchaseType} onChange={(event) => setPurchaseType(event.target.value)}><option value="all">All purchases</option><option value="membership">Membership purchases</option><option value="subscriptions">Subscription purchases</option></select></label>}
      <button className="EditorIconButton" title="Refresh report" aria-label="Refresh report" disabled={loading || deleteBusy || scheduleBusy} onClick={() => load()}><RefreshCw size={18} /></button>
    </div>
    <div className="ReportsExports"><span>{filtered.length} matching records</span>
      <button className="EditorCommand" disabled={!filtered.length || loading} onClick={exportRecords}><Download size={18} /> Download report CSV</button>
      {kind === 'members' && <button className="EditorCommand" disabled={!justgoUploadRows(filtered).length || loading} onClick={() => download(`fcc-justgo-staff-upload-${new Date().toISOString().slice(0, 10)}.csv`, reportCsv(justgoUploadHeaders, justgoUploadRows(filtered)))}><Download size={18} /> Staff upload list ({justgoUploadRows(filtered).length})</button>}
      <button className="EditorCommand" disabled={!emails.length || loading} onClick={() => download(`fcc-${kind}-emails.csv`, reportCsv(['Email'], emails.map((email) => [email])))}><Mail size={18} /> Export emails ({emails.length})</button>
    </div>
    {checkedAt && <p className="ReportNotice" role="status">Stripe {stripeMode} data checked and imported at {new Date(checkedAt).toLocaleString('en-GB')}. Stable club IDs retained. Snapshot only; no automatic refresh.</p>}
    {kind === 'subscribers' && clubYearEnd && <p className="ReportNotice">Club-year end: {dateLabel(clubYearEnd)} at midnight Europe/London. Opening this report imports subscribers, but does not change their billing. Use an individual record to confirm scheduling its end.</p>}
    {cursor && <p className="ReportNotice">Downloads include only loaded records matching the filters. Load all pages for a complete report.</p>}
    {kind === 'events' && <p className="ReportNotice">Event tickets are listed separately with the schedule saved at purchase. Totals cover event items only; each course ticket covers every listed session. Check payment status before treating a booking as paid. Load further pages even if a page has no events. Delete entire orders from Purchases, not this event-only view.</p>}
    <p className="ReportNotice">{kind === 'subscribers' ? 'Active means Stripe reports active and payments are not paused or reversed on the latest invoice. Scheduled cancellation remains active until Stripe changes the status. Older refunds and disputes are not checked here. These are recurring Stripe subscriptions, not annual one-off purchases.' : kind === 'members' ? 'One register for every member. JustGo is the authority on whether a member is current and becomes their renewal method once they are linked. New website members are sent to JustGo automatically; an invitation JustGo emails to them can expire, so it is retried. Anyone the automatic upload could not complete shows Needs staff upload with the number of failed attempts, and appears on the staff upload list. Search covers names, JustGo numbers, emergency contacts and what a membership includes.' : 'Purchases are not a verified member register. Use Stripe subscribers for current recurring subscription status.'} Email export does not establish permission to send marketing.</p>
    {error && !deleting && <p className="StatusTextError" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="ReportsTableWrap"><table className="ReportsTable"><thead><tr>
      {(kind === 'subscribers' ? ['Customer', 'Email', 'Subscription', 'Status', 'Plans', 'Period end', ''] : purchaseReport ? ['Order', 'Customer email', kind === 'events' ? 'Event / course schedule' : 'Purchased', 'Status', kind === 'events' ? 'Tickets total' : 'Total', 'Created', ''] : ['Member', 'Email', 'JustGo ID', 'Tier', 'Status', 'Valid until', 'Includes', 'JustGo', '']).map((label, index) => <th key={index} scope="col">{label || 'Actions'}</th>)}
    </tr></thead><tbody>
      {filtered.map((record) => <tr key={record.id}>{purchaseReport ? <>
        <td><button className="ContentLink" onClick={() => setSelected(record)}>{record.id}</button></td><td>{record.email || 'Not recorded'}</td>
        <td>{record.items.map((item, index) => <div key={index}>{item.name}{item.eventSchedule && <p>{eventScheduleLabel(item.eventSchedule)}</p>}</div>)}{record.subscriptionWarning && <span className="ReportWarning">Stripe check</span>}</td>
        <td>{record.status}</td><td>{money(record.total)}</td><td>{dateLabel(record.createdAt)}</td>
      </> : kind === 'subscribers' ? <>
        <td><button className="ContentLink" onClick={() => setSelected(record)}>{record.name || record.stripeCustomerId}</button><div>{record.clubCustomerId}</div></td><td>{record.email || 'Not recorded'}</td>
        <td><a className="ContentLink" href={`https://dashboard.stripe.com/${stripeMode === 'test' ? 'test/' : ''}subscriptions/${encodeURIComponent(record.id)}`} target="_blank" rel="noreferrer">{record.id}</a></td>
        <td>{record.status}<div>{record.stripeStatus}</div>{record.reason && <span className="ReportWarning">{record.reason}</span>}{!record.refundCheckAvailable && <div className="ReportWarning">Refund check unavailable</div>}</td>
        <td>{record.items.map((item, index) => <div key={index}>{item.name}<br />{item.amount ?? 'Variable'} {item.currency.toUpperCase()} / {item.interval} {item.quantity > 1 ? `× ${item.quantity}` : ''}</div>)}</td>
        <td>{dateLabel(record.currentPeriodEnd)}{(record.cancelAt || record.cancelAtPeriodEnd) && <div>Ends: {dateLabel(record.cancelAt || record.currentPeriodEnd)}</div>}</td>
      </> : <><td><button className="ContentLink" onClick={() => setSelected(record)}>{record.name || record.id}</button></td><td>{record.email || 'Not recorded'}</td><td>{record.scaId || 'None'}</td><td>{record.tier || 'Not set'}</td><td>{record.status}</td><td>{dateLabel(record.expiry)}</td><td>{record.privileges.join(', ') || 'Membership only'}</td><td>{record.justgo}{record.renewalMethod === 'justgo' ? ' (renews via JustGo)' : ''}</td></>}
        <td><div className="ReportsRowActions"><button className="EditorIconButton" title="Record details" aria-label={`Details for ${record.id}`} onClick={() => setSelected(record)}><FileText size={16} /></button>{kind === 'subscribers' && record.status === 'Active' && record.clubCustomerId && <button className="EditorIconButton" title="Schedule club-year cancellation" aria-label={`Schedule club-year end for ${record.id}`} onClick={() => { setSelected(record); setError(''); }}><CalendarClock size={16} /></button>}{!['subscribers', 'events'].includes(kind) && <button className="EditorIconButton TileRemove" title="Delete record" aria-label={`Delete ${record.id}`} onClick={() => beginDelete(record)}><Trash2 size={16} /></button>}</div></td>
      </tr>)}
      {!filtered.length && <tr><td colSpan="7">{loading ? 'Loading records…' : 'No matching records.'}</td></tr>}
    </tbody></table></div>
    {cursor && <button className="EditorCommand SpaceT4" disabled={loading} onClick={() => load(cursor)}>{loading ? 'Loading…' : 'Load next 100 records'}</button>}
    {(selected || deleting) && <div className="ReportsModalBackdrop"><section className="ReportsDialog" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title">
      <div className="ReportsHeader"><h3 id="record-dialog-title" className="tile_heading_bold_1">{deleting ? 'Delete record' : 'Record details'}</h3><button ref={closeButton} className="EditorIconButton" aria-label="Close record dialog" disabled={deleteBusy || scheduleBusy} onClick={() => { setSelected(null); setDeleting(null); }}><X size={18} /></button></div>
      <p className="ReportRecordId">{(selected || deleting).id}</p>
      {selected && <><dl className="ReportDetails">{Object.entries(selected).filter(([key]) => !['items', 'people', 'history'].includes(key)).map(([key, value]) => <React.Fragment key={key}><dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())}</dt><dd>{detailValue(value)}</dd></React.Fragment>)}</dl>
        {selected.items && <ul className="ReportItems">{selected.items.map((item, index) => <li key={index}>{item.name} {kind === 'subscribers' ? `${item.amount ?? 'Variable'} ${item.currency.toUpperCase()} / ${item.interval}` : item.price === null ? '' : money(item.price)}{item.eventSchedule && <p>{eventScheduleLabel(item.eventSchedule)}</p>}</li>)}</ul>}
        {selected.people?.length > 0 && <div className="ReportPeople"><h4 className="CartItemTitle">People on this order</h4>{selected.people.map((person, index) => <dl key={index} className="ReportDetails">
          {[['Name', person.name], ['Date of birth', person.dob], ['Type', person.returningMember ? `${person.kind} (existing member)` : person.kind], ['Items', person.items.join(', ')], ['Email', person.email], ['Phone', person.phone], ['Address', person.address], ['Emergency contact', person.emergencyContact], ['Swimming', person.swimming], ['Medical', person.medical], ['Photo consent', person.photoConsent ? 'Yes' : 'No'], ['Membership ID', person.membershipId]].filter(([, value]) => value).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
        </dl>)}</div>}
        {selected.history?.length > 0 && <div className="ReportPeople"><h4 className="CartItemTitle">Purchase history</h4><ul className="ReportItems">{selected.history.map((entry, index) => <li key={index}>{entry.orderRef}, {dateLabel(entry.paidAt)}: {entry.items.join(', ')}</li>)}</ul></div>}
        {kind === 'members' && selected.justgoSync === 'pending' && <div className="ReportsRowActions">
          <button className="EditorCommand" type="button" onClick={() => justgoAction(selected.id, 'retry')}>Retry automatic JustGo upload</button>
          <button className="EditorCommand" type="button" onClick={() => justgoAction(selected.id, 'manual')}>Staff added them in JustGo</button>
        </div>}
        {selected.email && <CustomerVouchers adminUser={adminUser} email={selected.email} />}
        {kind === 'subscribers' && selected.status === 'Active' && clubYearEnd && selected.clubCustomerId && <form onSubmit={(event) => { event.preventDefault(); scheduleCancellation(); }}>
          <div className="ReportDeleteWarning"><AlertTriangle size={22} /><div><strong>Changes {stripeMode} Stripe billing</strong><p>Schedule this subscription to stop at midnight on {dateLabel(clubYearEnd)}. Existing earlier cancellations are preserved. This does not cancel the bank mandate itself, issue refunds, or buy next year's membership. The customer must make a fresh purchase for the next club year.</p></div></div>
          <label className="FormLabel SpaceT4">Type subscription ID to schedule its end<input className="FormInput" value={scheduleConfirmation} onChange={(event) => setScheduleConfirmation(event.target.value)} autoComplete="off" disabled={scheduleBusy} /></label>
          <label className="AdminCheckbox ReportNotice"><input type="checkbox" checked={scheduleAcknowledged} onChange={(event) => setScheduleAcknowledged(event.target.checked)} disabled={scheduleBusy} /> I approve changing this customer's Stripe billing at the club-year end.</label>
          {error && <p className="StatusTextError" role="alert">{error}</p>}
          <button className="EditorCommand" type="submit" disabled={scheduleBusy || scheduleConfirmation !== selected.id || !scheduleAcknowledged}><CalendarClock size={18} /> {scheduleBusy ? 'Confirming with Stripe…' : 'Schedule club-year end'}</button>
        </form>}
        {!['subscribers', 'events'].includes(kind) && <button className="EditorCommand TileRemove" onClick={() => beginDelete(selected)}><Trash2 size={18} /> Delete this record</button>}</>}
      {deleting && <form onSubmit={(event) => { event.preventDefault(); deleteRecord(); }}>
        <p className="ReportNotice">Permanently deletes this {kind === 'orders' ? 'order' : 'member-register'} record only. Other customer records, Firebase login accounts, vouchers, Google Sheets, emails, and Stripe subscriptions remain unchanged. This is not complete customer erasure. Check retention requirements first.</p>
        {stripeRequired && <div className="ReportDeleteWarning"><AlertTriangle size={22} /><div><strong>Cancel active subscriptions in Stripe first.</strong><p>Deleting website data does not stop recurring payments.{deleting.stripeSubscriptionId && ` Subscription: ${deleting.stripeSubscriptionId}`}</p><a className="ContentLink" href="https://dashboard.stripe.com/test/subscriptions" target="_blank" rel="noreferrer">Open Stripe test subscriptions</a><label><input type="checkbox" checked={stripeAcknowledged} onChange={(event) => setStripeAcknowledged(event.target.checked)} required /> I have checked Stripe and cancelled any active subscription before deletion.</label></div></div>}
        <label className="FormLabel SpaceT4">Type the record ID to confirm<input className="FormInput" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        {error && <p className="StatusTextError" role="alert">{error}</p>}
        <button className="EditorCommand TileRemove" type="submit" disabled={deleteBusy || confirmation !== deleting.id || (stripeRequired && !stripeAcknowledged)}><Trash2 size={18} /> {deleteBusy ? 'Deleting…' : 'Permanently delete record'}</button>
      </form>}
    </section></div>}
  </div>;
}