import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, ArrowRight, Download, FilePlus2, History, RotateCcw, Send } from 'lucide-react';
import { ContentText } from '../components/ContentText';
import { usePageEditor } from '../utils/PageContentContext';
import { NOTICE_ID_PATTERN, NOTICE_LIMITS, noticeIdFromTitle, parseNoticeBlocks, sortNotices } from '../utils/notices';
import { archiveNotice, loadNoticeVersions, noticePdfUrl, publishNotice, reorderNotices, watchPublishedNotices } from '../utils/noticesClient';

const formatDate = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : '';
};

const hashId = () => {
  try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ''; }
};

export function NoticeDocument({ body }) {
  return <div className="NoticeDocument">{parseNoticeBlocks(body).map((block, index) => {
    if (block.type === 'heading') return block.level === 2
      ? <h3 key={index} className="NoticeHeading"><ContentText value={block.text} /></h3>
      : <h4 key={index} className="NoticeSubheading"><ContentText value={block.text} /></h4>;
    if (block.type === 'list') {
      const List = block.ordered ? 'ol' : 'ul';
      return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><ContentText value={item} /></li>)}</List>;
    }
    return <p key={index} className="AdminPreserveLines"><ContentText value={block.text} /></p>;
  })}</div>;
}

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

function NoticeEditor({ notice, draft, onDraft, onDiscard, busy, onPublish }) {
  const dirty = draft.isNew || draft.title !== notice?.title || draft.body !== notice?.body;
  const nextVersion = (notice?.currentVersion || 0) + 1;
  return <div className="NoticeEditor" data-editor-control="true">
    <label className="FormLabel">Title<input className="FormInput" maxLength={NOTICE_LIMITS.title} value={draft.title}
      onChange={(event) => onDraft({ ...draft, title: event.target.value })} /></label>
    <label className="FormLabel">Notice text
      <textarea className="FormInput NoticeTextarea" rows={18} maxLength={NOTICE_LIMITS.body} value={draft.body}
        onChange={(event) => onDraft({ ...draft, body: event.target.value })} />
    </label>
    <p className="NoticeEditorHelp">Leave a blank line between paragraphs. Start a line with <code>## </code> for a heading, <code>### </code> for a smaller heading,
      <code>- </code> for a bullet or <code>1. </code> for a numbered item. Links: <code>[link text](https://…)</code>, <code>[text](/membership)</code> or <code>[email us](mailto:…)</code>.</p>
    <div className="NoticeEditorActions">
      <button type="button" className="EditorCommand EditorPublish" disabled={busy || !dirty || !draft.title.trim() || !draft.body.trim()} onClick={onPublish}>
        <Send size={16} /> Publish version {nextVersion}
      </button>
      <button type="button" className="EditorCommand" disabled={busy || !dirty} onClick={onDiscard}><RotateCcw size={16} /> {draft.isNew ? 'Remove draft' : 'Discard changes'}</button>
    </div>
    {dirty && <p className="NoticeEditorHelp">Preview below. Publishing makes version {nextVersion} live straight away, and people agree to it at their next checkout.</p>}
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
  const tabRefs = useRef({});

  useEffect(() => watchPublishedNotices(setState), []);
  useEffect(() => {
    const follow = () => setSelectedId(hashId());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  useEffect(() => { if (!adminUser) setEditing(false); }, [adminUser]);

  const canEdit = Boolean(adminUser && editing);
  const publishedIds = new Set((state.notices || []).map((item) => item.id));
  const newDrafts = Object.entries(drafts).filter(([id, draft]) => draft.isNew && !publishedIds.has(id)).map(([id, draft]) => ({ id, title: draft.title || 'New notice', draft: true }));
  const tabs = useMemo(() => [...(state.notices || []), ...(canEdit ? newDrafts : [])], [state.notices, canEdit, drafts]);
  const archived = sortNotices(state.all.filter((notice) => notice.archived));
  const selected = tabs.find((tab) => tab.id === selectedId) || tabs[0];
  const notice = state.notices?.find((item) => item.id === selected?.id);
  const draft = selected && drafts[selected.id];
  const shownTitle = canEdit && draft ? draft.title : selected?.title;
  const shownBody = canEdit && draft ? draft.body : notice?.body || '';

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
      await action();
      setStatus({ message, error: '' });
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
    const taken = new Set([...(state.notices || []).map((item) => item.id), ...Object.keys(drafts)]);
    let id = base;
    for (let suffix = 2; taken.has(id); suffix += 1) id = `${base.slice(0, 55)}-${suffix}`;
    if (!NOTICE_ID_PATTERN.test(id)) return setStatus({ message: '', error: 'Choose a shorter title for the new notice.' });
    const previous = archived.find((item) => item.id === id);
    setDraft(id, { title, body: previous?.body || '', isNew: true });
    setNewTitle('');
    setStatus({ message: previous ? `An archived notice used this name. Its last wording is loaded; publishing brings it back as a new version.` : '', error: '' });
    select(id);
  };
  const publish = () => run(async () => {
    const result = await publishNotice(adminUser, selected.id, draft);
    dropDraft(selected.id);
    if (!result.changed) throw new Error('The wording is the same as the published version, so no new version was made.');
  }, `${draft.title.trim()} published.`);
  const move = (direction) => {
    const ids = state.notices.map((item) => item.id);
    const index = ids.indexOf(notice.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => reorderNotices(adminUser, [...ids, ...archived.map((item) => item.id)]), 'Order saved.');
  };
  const archive = () => {
    if (!window.confirm(`Archive "${notice.title}"? It disappears from this page and from checkout. Its versions and everyone's agreement records are kept.`)) return;
    run(async () => { await archiveNotice(adminUser, notice.id); dropDraft(notice.id); }, `${notice.title} archived.`);
  };
  const restore = (item) => run(() => publishNotice(adminUser, item.id, item), `${item.title} restored.`);

  return <div className="SectionContent PageFadeIn NoticesPage">
    <span className="tile_eyebrow">Policies and terms</span>
    <h1 className="page_heading_bold_2">Notices</h1>
    <p className="text_container text_container_intro">How Forth Canoe Club uses your information, and the terms you agree to when you join or book. Choose a notice to read it, or download it as a PDF.</p>

    {adminUser && <div className="NoticeAdminBar" data-editor-control="true">
      <label className="EditorModeSwitch"><input type="checkbox" checked={editing} onChange={(event) => setEditing(event.target.checked)} /> Edit notices</label>
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
            {notice && <p className="NoticeMeta">Version {notice.currentVersion}{formatDate(notice.publishedAt) ? ` · Published ${formatDate(notice.publishedAt)}` : ''}</p>}
          </div>
          {notice && <a className="PrimaryActionButtonCompact" href={noticePdfUrl(notice.id, notice.currentVersion)} aria-label={`Download ${notice.title} as a PDF`}>
            <Download className="IconSm" /> PDF
          </a>}
        </header>
        {canEdit && <>
          <NoticeEditor notice={notice} draft={draft || { title: notice.title, body: notice.body }} busy={busy}
            onDraft={(value) => setDraft(selected.id, value)} onDiscard={() => dropDraft(selected.id)} onPublish={publish} />
          {notice && <div className="NoticeEditorActions" data-editor-control="true">
            <button type="button" className="EditorIconButton" title="Move left" aria-label={`Move ${notice.title} left`} disabled={busy || state.notices[0]?.id === notice.id} onClick={() => move(-1)}><ArrowLeft size={18} /></button>
            <button type="button" className="EditorIconButton" title="Move right" aria-label={`Move ${notice.title} right`} disabled={busy || state.notices.at(-1)?.id === notice.id} onClick={() => move(1)}><ArrowRight size={18} /></button>
            <button type="button" className="EditorCommand" disabled={busy} onClick={archive}><Archive size={16} /> Archive</button>
          </div>}
          {notice && <VersionHistory adminUser={adminUser} notice={notice} />}
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

    {canEdit && archived.length > 0 && <details className="NoticeHistory" data-editor-control="true">
      <summary><Archive size={16} /> Archived notices ({archived.length})</summary>
      <ul className="NoticeHistoryList">{archived.map((item) => <li key={item.id}>
        <span><strong>{item.title}</strong> · version {item.currentVersion}</span>
        <span><a className="ContentLink" href={noticePdfUrl(item.id, item.currentVersion)}>PDF</a>{' '}
          <button type="button" className="EditorCommand" disabled={busy} onClick={() => restore(item)}>Restore</button></span>
      </li>)}</ul>
    </details>}
  </div>;
}
