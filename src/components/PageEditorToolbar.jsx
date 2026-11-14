import React from 'react';
import { ExternalLink, LogOut, Save, Send, Undo2 } from 'lucide-react';
import { usePageEditor } from '../utils/PageContentContext';

export default function PageEditorToolbar({ pageId }) {
  const editor = usePageEditor();
  if (!editor.adminUser) return null;
  const statusUnavailable = editor.checkingDraftStatus || Boolean(editor.draftStatusError);
  const status = editor.checkingDraftStatus ? 'Checking saved drafts against browser changes…'
    : editor.unsavedPages.some((page) => page.id === pageId) ? 'This page has browser changes not saved to GitHub.'
      : editor.unpublishedPages.some((page) => page.id === pageId) ? 'This page has a saved draft that is not published.'
        : 'No unsaved changes for this page.';
  return <div className="PageEditorToolbar" data-editor-control="true">
    <label className="EditorModeSwitch"><input type="checkbox" checked={editor.editMode} onChange={(event) => editor.setEditMode(event.target.checked)} /> Edit Mode</label>
    {editor.editMode && <>
      <button className="EditorCommand" disabled={editor.busy || statusUnavailable || !editor.unsavedPages.length} onClick={() => editor.save(pageId)}><Save size={18} /> Save all drafts</button>
      <button className="EditorCommand EditorPublish" disabled={editor.busy || statusUnavailable} onClick={() => editor.save(pageId, true)}><Send size={18} /> {editor.unsavedPages.length ? 'Save all & request review' : 'Request publication review'}</button>
      <button className="EditorIconButton" title="Discard local page changes" aria-label="Discard local page changes" disabled={editor.busy} onClick={() => editor.discard(pageId)}><Undo2 size={18} /></button>
    </>}
    <button className="EditorIconButton" title="Sign out" aria-label="Sign out" onClick={() => editor.logout().catch(() => window.alert('Sign-out failed. Please try again.'))}><LogOut size={18} /></button>
    {editor.authError && <span className="EditorStatus EditorError" role="alert">{editor.authError} <button type="button" className="EditorRetryButton" disabled={editor.authRetrying} onClick={editor.retryAuth}>{editor.authRetrying ? 'Retrying…' : 'Retry session'}</button></span>}
    {editor.draftStatusError && <span className="EditorStatus EditorError" role="alert">{editor.draftStatusError} <button type="button" className="EditorRetryButton" disabled={editor.checkingDraftStatus} onClick={editor.retryDraftStatus}>Retry draft status</button></span>}
    {!statusUnavailable && editor.unsavedPages.length > 0 && <span className="EditorUnsavedPages">Unsaved browser changes ({editor.unsavedPages.length}): {editor.unsavedPages.map((page) => page.label).join(', ')}</span>}
    {!statusUnavailable && editor.unpublishedPages.length > 0 && <span className="EditorUnpublishedPages">Saved, not published ({editor.unpublishedPages.length}): {editor.unpublishedPages.map((page) => page.label).join(', ')}</span>}
    {!editor.draftStatusError && <span className={editor.error ? 'EditorStatus EditorError' : 'EditorStatus'} role="status">{editor.busy ? 'Saving all changed pages…' : editor.error || editor.message || status}</span>}
    {editor.review?.url && <a className="ContentLink" target="_blank" rel="noreferrer" href={editor.review.url}>Review #{editor.review.number} <ExternalLink size={14} /></a>}
  </div>;
}
