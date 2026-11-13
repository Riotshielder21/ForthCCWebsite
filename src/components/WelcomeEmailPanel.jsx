import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Mail, Minus, Quote, Redo2, Send, Strikethrough, Underline, Undo2, Unlink } from 'lucide-react';
import { apiUrl, apiFetch } from '../utils/api';
import { renderWelcomeEmail, sampleWelcomeValues, validateWelcomeDoc, validateWelcomeSubject, WELCOME_LIMITS, WELCOME_PLACEHOLDERS } from '../utils/welcomeEmail';

const TOOLS = [
  ['Bold', Bold, (chain) => chain.toggleBold(), 'bold'],
  ['Italic', Italic, (chain) => chain.toggleItalic(), 'italic'],
  ['Underline', Underline, (chain) => chain.toggleUnderline(), 'underline'],
  ['Strikethrough', Strikethrough, (chain) => chain.toggleStrike(), 'strike'],
  ['Heading', Heading2, (chain) => chain.toggleHeading({ level: 2 }), ['heading', { level: 2 }]],
  ['Subheading', Heading3, (chain) => chain.toggleHeading({ level: 3 }), ['heading', { level: 3 }]],
  ['Bulleted list', List, (chain) => chain.toggleBulletList(), 'bulletList'],
  ['Numbered list', ListOrdered, (chain) => chain.toggleOrderedList(), 'orderedList'],
  ['Quote', Quote, (chain) => chain.toggleBlockquote(), 'blockquote'],
  ['Divider', Minus, (chain) => chain.setHorizontalRule()]
];

/** Rich text welcome email sent once per membership term to new and renewing members (website and JustGo). */
export default function WelcomeEmailPanel({ adminUser }) {
  const [saved, setSaved] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState('');
  const [doc, setDoc] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit.configure({ code: false, codeBlock: false, heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto'] } })],
    editorProps: { attributes: { class: 'WelcomeEditorContent', 'aria-label': 'Welcome email body', 'aria-multiline': 'true', role: 'textbox' } },
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: current }) => setDoc(current.getJSON())
  });

  const request = useCallback(async (path, options = {}) => {
    const token = await adminUser.getIdToken();
    const response = await apiFetch(apiUrl(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error('The API server did not respond. For local development set VITE_API_BASE_URL (see DEVELOPMENT.md).');
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }, [adminUser]);

  const apply = useCallback((result) => {
    setSaved(result);
    setEnabled(result.enabled);
    setSubject(result.subject);
    setDoc(result.doc);
    editor?.commands.setContent(result.doc, { emitUpdate: false });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    request('/api/admin/welcome-email').then(apply).catch((loadError) => setError(loadError.message));
  }, [editor, request, apply]);

  const checked = useMemo(() => {
    const checkedSubject = validateWelcomeSubject(subject);
    const checkedDoc = doc ? validateWelcomeDoc(doc) : new Error('Loading…');
    return { problem: [checkedSubject, checkedDoc].find((value) => value instanceof Error)?.message || '', subject: checkedSubject, doc: checkedDoc };
  }, [subject, doc]);
  const preview = useMemo(() => checked.problem ? null : renderWelcomeEmail({ subject: checked.subject, doc: checked.doc }, sampleWelcomeValues()), [checked]);
  const dirty = Boolean(saved) && (enabled !== saved.enabled || subject !== saved.subject || JSON.stringify(doc) !== JSON.stringify(saved.doc));

  const run = async (action) => {
    setError('');
    setMessage('');
    setBusy(true);
    try { setMessage(await action()); }
    catch (actionError) { setError(actionError.message); }
    finally { setBusy(false); }
  };
  const save = (event) => {
    event.preventDefault();
    run(async () => {
      apply(await request('/api/admin/welcome-email', { method: 'POST', body: JSON.stringify({ enabled, subject, doc }) }));
      return enabled ? 'Welcome email saved. New and renewing members will receive it from now on.' : 'Welcome email saved. It is switched off, so nothing will be sent.';
    });
  };
  const sendTest = () => run(async () => {
    const result = await request('/api/admin/welcome-email/test', { method: 'POST', body: JSON.stringify({ subject, doc }) });
    return `Test email sent to ${result.sentTo} using sample member details.`;
  });
  const setLink = () => {
    const current = editor.getAttributes('link').href || 'https://';
    const href = window.prompt('Link address (https://… or mailto:…)', current);
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  return (
    <form className="main_tile SpaceT6" onSubmit={save}>
      <div className="AdminListHeader"><div><span className="tile_eyebrow">Membership</span><h3 className="tile_heading_bold_2">Welcome email</h3></div></div>
      <p className="text_container SpaceB4">Sent once to everyone who gets a membership: new website members and renewals, and people who join or renew through JustGo (picked up by the daily sync). For juniors it goes to the parent or guardian. Members imported by the very first JustGo sync are not emailed.</p>
      <label className="AdminCheckbox SpaceB4"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={!saved} /> Send the welcome email</label>
      <label className="FormLabel">Subject
        <input className="FormInput" value={subject} maxLength={WELCOME_LIMITS.subject} onChange={(event) => setSubject(event.target.value)} disabled={!saved} />
      </label>
      <div className="WelcomeEditor SpaceT4">
        <div className="WelcomeEditorToolbar" role="toolbar" aria-label="Formatting">
          {TOOLS.map(([label, Icon, command, active]) => (
            <button key={label} type="button" className={`EditorIconButton${active && editor?.isActive(...[].concat(active)) ? ' is-active' : ''}`} title={label} aria-label={label}
              aria-pressed={active ? Boolean(editor?.isActive(...[].concat(active))) : undefined} disabled={!editor || !saved} onClick={() => command(editor.chain().focus()).run()}><Icon size={16} /></button>
          ))}
          <button type="button" className={`EditorIconButton${editor?.isActive('link') ? ' is-active' : ''}`} title="Add or change link" aria-label="Add or change link" disabled={!editor || !saved} onClick={setLink}><LinkIcon size={16} /></button>
          <button type="button" className="EditorIconButton" title="Remove link" aria-label="Remove link" disabled={!editor?.isActive('link')} onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}><Unlink size={16} /></button>
          <button type="button" className="EditorIconButton" title="Undo" aria-label="Undo" disabled={!editor?.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></button>
          <button type="button" className="EditorIconButton" title="Redo" aria-label="Redo" disabled={!editor?.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></button>
        </div>
        <EditorContent editor={editor} />
      </div>
      <div className="WelcomePlaceholders SpaceT3" aria-label="Insert member details">
        <span className="text_container_note">Insert:</span>
        {WELCOME_PLACEHOLDERS.map(({ key, label }) => (
          <button key={key} type="button" className="EditorCommand" disabled={!editor || !saved} onClick={() => editor.chain().focus().insertContent(`{{${key}}}`).run()}>{label}</button>
        ))}
      </div>
      <p className="text_container text_container_note SpaceT3">Details such as <code>{'{{firstName}}'}</code> are filled in for each member. Links must start with https://, http:// or mailto:. Pasted styles, images and scripts are removed.</p>

      <h4 className="CartItemTitle SpaceT6">Preview with sample details</h4>
      {preview ? <>
        <p className="text_container"><strong>Subject:</strong> {preview.subject}</p>
        <iframe className="WelcomePreview" title="Welcome email preview" sandbox="" srcDoc={preview.html} />
      </> : <p className="text_container text_container_note">{checked.problem}</p>}

      {saved?.updatedAt > 0 && <p className="text_container text_container_note SpaceT3">Last changed {new Date(saved.updatedAt).toLocaleString('en-GB')} by {saved.updatedBy}.</p>}
      {message && <p className="StatusText StatusTextSuccess">{message}</p>}{error && <p className="StatusText StatusTextError">{error}</p>}
      <div className="NoticeEditorActions SpaceT4">
        <button className="FormSubmitButton" type="submit" disabled={busy || !saved || Boolean(checked.problem) || !dirty}><Mail className="IconMd" /> Save welcome email</button>
        <button className="EditorCommand" type="button" disabled={busy || !saved || Boolean(checked.problem)} onClick={sendTest}><Send size={16} /> Send me a test</button>
      </div>
    </form>
  );
}
