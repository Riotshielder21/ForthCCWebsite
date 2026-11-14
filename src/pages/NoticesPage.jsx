import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FilePlus2, History, RotateCcw, Send } from 'lucide-react';
import { NoticeDocument } from '../components/NoticeDocument';
import { usePageEditor } from '../utils/PageContentContext';
import { NOTICE_ID_PATTERN, NOTICE_LIMITS, noticeIdFromTitle } from '../utils/notices';
import { loadNoticeMode, loadNoticeVersions, noticePdfUrl, publishNotice, reorderNotices, watchPublishedNotices } from '../utils/noticesClient';
import { DISCLAIMER, PHOTO_CONSENT } from '../constants/consentWording';
import { NOTICE_DRAFTS } from '../constants/noticeDrafts';

/** Statements ticked per person at checkout. Their wording is set in the code and versioned on release, so it is shown here read-only. */
const TICKED_STATEMENTS = [DISCLAIMER, PHOTO_CONSENT].map(({ id, title, label, body }) => ({ id, title, body: `${label}\n\n${body}`, ticked: true }));

const formatDate = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : '';
};

const hashId = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ''; }
};

function VersionHistory({ adminUser, notice }) {
  const [state, setState] = useState({ versions: null, error: '' });
  useEffect(() => {
    let active = true;
    setState({ versions: null, error: '' });
    loadNoticeVersions(adminUser, notice.id)
      .then((versions) => active && setState({ versions, error: '' }))
      .catch((error) => active && setState({ versions: [], error: error.message }));
    return () => { active = false; };
  }, [adminUser, notice.id, notice.currentVersion]);
  return <details className="NoticeHistory" data-editor-control="true">
    <summary><History size={16} /> Version history</summary>
    {state.versions === null && <p role="status">Loading versions…</p>}
    {state.error && <p className="EditorError" role="alert">{state.error}</p>}
    {state.versions?.length > 0 && <ol className="NoticeHistoryList">{state.versions.map((version) => <li key={version.version}>
      <span><strong>Version {version.version}</strong> · {formatDate(version.publishedAt)} · {version.publishedBy || 'unknown'}</span>
      <a className="ContentLink" href={noticePdfUrl(notice.id, version.version)}>PDF</a>
    </li>)}</ol>}
  </details>;
}

function NoticeEditor({ adminUser, notice, draft, preLive, tabs, onDraft, onDiscard, busy, onPublish }) {
  const textarea = useRef(null);
  const dirty = draft.isNew || draft.title !== notice?.title || draft.body !== notice?.body;
  const nextVersion = preLive ? 1 : (notice?.currentVersion || 0) + 1;
  const insertNoticeLink = (tab) => {
    const start = textarea.current?.selectionStart ?? draft.body.length;
    const end = textarea.current?.selectionEnd ?? start;
    const label = tab.title.replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const link = `[${label}](/notices#${encodeURIComponent(tab.id)})`;
    const before = draft.body.slice(0, start);
    const after = draft.body.slice(end);
    const insertion = `${before && !/\s$/.test(before) ? ' ' : ''}${link}${after && !/^\s/.test(after) ? ' ' : ''}`;
    onDraft({ ...draft, body: `${before}${insertion}${after}` });
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  };
  return <div className="NoticeEditor" data-editor-control="true">
    <label className="FormLabel">Title<input className="FormInput" maxLength={NOTICE_LIMITS.title} value={draft.title}
      onChange={(event) => onDraft({ ...draft, title: event.target.value })} /></label>
    <label className="FormLabel">Notice text
      <textarea ref={textarea} className="FormInput NoticeTextarea" rows={18} maxLength={NOTICE_LIMITS.body} value={draft.body}
        onChange={(event) => onDraft({ ...draft, body: event.target.value })} />
    </label>
    <details className="NoticeInsertLinks" data-editor-control="true">
      <summary>Insert a link to a notice tab</summary>
      <div className="WelcomePlaceholders SpaceT2">
        {tabs.map((tab) => <button key={tab.id} type="button" className="EditorCommand" onClick={() => insertNoticeLink(tab)}>{tab.title}</button>)}
      </div>
    </details>
    <p className="NoticeEditorHelp">Leave a blank line between paragraphs. Start a line with <code>## </code> for a heading, <code>### </code> for a smaller heading,
      <code>- </code> for a bullet or <code>1. </code> for a numbered item. Links: <code>[link text](https://…)</code>, <code>[text](/membership)</code> or <code>[email us](mailto:…)</code>.</p>
    <div className="NoticeVersionControls" data-editor-control="true">
      <span className="NoticeControlLabel">Version and changes</span>
      <button type="button" className="EditorCommand EditorPublish" disabled={busy || !dirty || !draft.title.trim() || !draft.body.trim()} onClick={onPublish}>
        <Send size={16} /> {preLive ? 'Save version 1' : `Publish version ${nextVersion}`}
      </button>
      <button type="button" className="EditorCommand" disabled={busy || !dirty} onClick={onDiscard}><RotateCcw size={16} /> {draft.isNew ? 'Remove draft' : 'Discard changes'}</button>
      {notice && !preLive && <VersionHistory adminUser={adminUser} notice={notice} />}
    </div>
    {dirty && <p className="NoticeEditorHelp">{preLive
      ? 'Preview below. Until the website goes live, each save replaces the working version 1. Version history starts at launch.'
      : `Preview below. Publishing makes version ${nextVersion} live straight away, and people agree to it at their next checkout.`}</p>}
  </div>;
}

export default function NoticesPage() {
  const { adminUser } = usePageEditor();
  const [state, setState] = useState({ notices: null, all: [], error: '' });
  const [selectedId, setSelectedId] = useState(hashId);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ message: '', error: '' });
  const [liveMode, setLiveMode] = useState(null);
  const tabRefs = useRef({});

  useEffect(() => watchPublishedNotices(setState), []);
  useEffect(() => {
    let active = true;
    loadNoticeMode().then((live) => { if (active) setLiveMode(live); })
      .catch((error) => { if (active) setStatus({ message: '', error: error.message }); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const follow = () => setSelectedId(hashId());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  useEffect(() => { if (!adminUser) setEditing(false); }, [adminUser]);

  const canEdit = Boolean(adminUser && editing);
  const publishedIds = new Set((state.notices || []).map((item) => item.id));
  const newDrafts = Object.entries(drafts).filter(([id, draft]) => draft.isNew && !publishedIds.has(id)).map(([id, draft]) => ({ id, title: draft.title || 'New notice', draft: true }));
  const tabs = useMemo(() => state.notices ? [...state.notices, ...(canEdit ? newDrafts : []), ...TICKED_STATEMENTS.filter((item) => !publishedIds.has(item.id))] : [],
    [state.notices, canEdit, drafts]);
  const allNoticeIds = new Set(state.all.map((item) => item.id));
  const missingDrafts = NOTICE_DRAFTS.filter((item) => !allNoticeIds.has(item.id) && !drafts[item.id]);
  const selected = tabs.find((tab) => tab.id === selectedId) || tabs[0];
  const ticked = selected?.ticked === true;
  const notice = state.notices?.find((item) => item.id === selected?.id);
  const draft = selected && !ticked && drafts[selected.id];
  const shownTitle = canEdit && draft ? draft.title : selected?.title;
  const shownBody = ticked ? selected.body : canEdit && draft ? draft.body : notice?.body || '';
  const preLive = notice ? notice.preLive === true : liveMode !== true;

  useEffect(() => {
    if (selected) tabRefs.current[selected.id]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected?.id, tabs.length]);

  const select = (id, focus = false) => {
    setSelectedId(id);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${encodeURIComponent(id)}`);
    if (focus) tabRefs.current[id]?.focus();
  };
  const onTabKey = (event, index) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    let next = null;
    if (Object.hasOwn(moves, event.key)) next = (index + moves[event.key] + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(tabs[next].id, true);
  };
  const run = async (action, message) => {
    setBusy(true);
    setStatus({ message: '', error: '' });
    try {
      const result = await action();
      setStatus({ message: typeof message === 'function' ? message(result) : message, error: '' });
    } catch (error) {
      setStatus({ message: '', error: error.message });
    } finally {
      setBusy(false);
    }
  };
  const setDraft = (id, value) => setDrafts((current) => ({ ...current, [id]: value }));
  const dropDraft = (id) => setDrafts(({ [id]: _removed, ...rest }) => rest);

  const addNotice = (event) => {
    event.preventDefault();
    const title = newTitle.trim();
    const base = noticeIdFromTitle(title);
    if (!base) return setStatus({ message: '', error: 'Give the new notice a title with some letters or numbers.' });
    const taken = new Set([...allNoticeIds, ...Object.keys(drafts)]);
    let id = base;
    for (let suffix = 2; taken.has(id); suffix += 1) id = `${base.slice(0, 55)}-${suffix}`;
    if (!NOTICE_ID_PATTERN.test(id)) return setStatus({ message: '', error: 'Choose a shorter title for the new notice.' });
    setDraft(id, { title, body: '', isNew: true });
    setNewTitle('');
    setStatus({ message: '', error: '' });
    select(id);
  };
  const publish = () => run(async () => {
    const result = await publishNotice(adminUser, selected.id, draft);
    dropDraft(selected.id);
    if (!result.changed) throw new Error('The wording is unchanged; nothing was saved.');
    return result;
  }, (result) => result.preLive
    ? `${draft.title.trim()} saved as the editable version 1.`
    : `${draft.title.trim()} published as version ${result.version}.`);
  const move = (direction) => {
    const ids = state.notices.map((item) => item.id);
    const index = ids.indexOf(notice.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => reorderNotices(adminUser, ids), 'Order saved.');
  };
  const openDraft = (item) => {
    const saved = state.all.find((noticeItem) => noticeItem.id === item.id);
    setDraft(item.id, { title: saved?.title || item.title, body: saved?.body || item.body, isNew: true });
    setStatus({ message: '', error: '' });
    select(item.id);
  };

  return <div className="SectionContent PageFadeIn NoticesPage">
    <span className="tile_eyebrow">Policies and terms</span>
    <h1 className="page_heading_bold_2">Notices</h1>
    <p className="text_container text_container_intro">How Forth Canoe Club uses your information, and the terms you agree to when you join or book. Choose a notice to read it, or download it as a PDF.</p>

    {adminUser && <div className="NoticeAdminBar" data-editor-control="true">
      <label className="EditorModeSwitch"><input type="checkbox" checked={editing} onChange={(event) => setEditing(event.target.checked)} /> Edit notices</label>
      {canEdit && missingDrafts.length > 0 && <details className="NoticeDraftPicker" data-editor-control="true">
        <summary><FilePlus2 size={16} /> Drafted notices ({missingDrafts.length})</summary>
        <p className="NoticeEditorHelp">Choose a draft to view and edit it. Save it when you are ready.</p>
        <div className="WelcomePlaceholders">
          {missingDrafts.map((item) => <button key={item.id} type="button" className="EditorCommand" onClick={() => openDraft(item)}>{item.title}</button>)}
        </div>
      </details>}
      {busy && <span className="EditorStatus" role="status">Saving…</span>}
      {!busy && (status.message || status.error) && <span className={status.error ? 'EditorStatus EditorError' : 'EditorStatus'} role={status.error ? 'alert' : 'status'}>{status.error || status.message}</span>}
    </div>}

    {state.error && <p className="StatusText StatusTextError" role="alert">{state.error}</p>}
    {state.notices === null && !state.error && <p role="status">Loading notices…</p>}
    {state.notices && !tabs.length && <p className="text_container">No notices have been published yet.</p>}

    {selected && <div className="NoticeLayout">
      <div className="NoticeTabs" role="tablist" aria-orientation="horizontal" aria-label="Notices">
        {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`notice-tab-${tab.id}`} ref={(node) => { tabRefs.current[tab.id] = node; }}
          className="NoticeTab" aria-selected={tab.id === selected.id} aria-controls="notice-panel" tabIndex={tab.id === selected.id ? 0 : -1}
          onClick={() => select(tab.id)} onKeyDown={(event) => onTabKey(event, index)}>
          {tab.title}{tab.draft ? ' (draft)' : ''}
        </button>)}
      </div>

      <section className="NoticePanel" role="tabpanel" id="notice-panel" aria-labelledby={`notice-tab-${selected.id}`} tabIndex={0}>
        <header className="NoticePanelHeader">
          <div>
            <h2 className="NoticeTitle">{shownTitle || 'New notice'}</h2>
            {notice && <p className="NoticeMeta">{preLive ? 'Working version 1 · Pre-launch' : `Version ${notice.currentVersion}${formatDate(notice.publishedAt) ? ` · Published ${formatDate(notice.publishedAt)}` : ''}`}</p>}
            {ticked && <p className="NoticeMeta">Ticked for each person at checkout and check-in{selected.id === PHOTO_CONSENT.id ? ' (optional)' : ''}. Every change to this wording is recorded as a new version.</p>}
          </div>
          {notice && notice.currentVersion > 0 && <a className="PrimaryActionButtonCompact" href={noticePdfUrl(notice.id, notice.currentVersion)} aria-label={`Download ${notice.title} as a PDF`}>
            <Download className="IconSm" /> PDF
          </a>}
        </header>
        {canEdit && !ticked && <>
          {notice && <fieldset className="NoticeOrderControls" data-editor-control="true">
            <legend>Notice tab order</legend>
            <span>These buttons change where this notice appears in the tab list.</span>
            <button type="button" className="EditorCommand" disabled={busy || state.notices[0]?.id === notice.id} onClick={() => move(-1)}>
              <ArrowLeft size={16} /> Move tab earlier
            </button>
            <button type="button" className="EditorCommand" disabled={busy || state.notices.at(-1)?.id === notice.id} onClick={() => move(1)}>
              <ArrowRight size={16} /> Move tab later
            </button>
          </fieldset>}
          <NoticeEditor adminUser={adminUser} notice={notice} draft={draft || { title: shownTitle || '', body: shownBody }} preLive={preLive} tabs={tabs} busy={busy}
            onDraft={(value) => setDraft(selected.id, value)} onDiscard={() => dropDraft(selected.id)} onPublish={publish} />
        </>}
        {shownBody ? <NoticeDocument body={shownBody} /> : canEdit && <p className="NoticeEditorHelp">Write the notice above to see a preview here.</p>}
      </section>
      {canEdit && <form className="NoticeAddForm" onSubmit={addNotice} data-editor-control="true">
        <label className="FormLabel">New notice title<input className="FormInput" value={newTitle} maxLength={NOTICE_LIMITS.title} onChange={(event) => setNewTitle(event.target.value)} /></label>
        <button type="submit" className="EditorCommand" disabled={!newTitle.trim()}><FilePlus2 size={16} /> Add notice</button>
      </form>}
    </div>}

    {canEdit && !selected && <form className="NoticeAddForm" onSubmit={addNotice} data-editor-control="true">
      <label className="FormLabel">First notice title<input className="FormInput" value={newTitle} maxLength={NOTICE_LIMITS.title} onChange={(event) => setNewTitle(event.target.value)} /></label>
      <button type="submit" className="EditorCommand" disabled={!newTitle.trim()}><FilePlus2 size={16} /> Add notice</button>
    </form>}

  </div>;
}
