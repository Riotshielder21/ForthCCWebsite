import React, { useRef, useState } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { parseContentLinks, replaceContentLink, safeTileUrl } from '../utils/contentLinks';

export function ContentText({ value }) {
  return parseContentLinks(value).map((part) => part.url && safeTileUrl(part.url)
    ? <a key={part.start} href={part.url} target={/^https:\/\//i.test(part.url) ? '_blank' : undefined}
      rel={/^https:\/\//i.test(part.url) ? 'noreferrer' : undefined}>{part.text}</a>
    : <React.Fragment key={part.start}>{part.url ? value.slice(part.start, part.end) : part.text}</React.Fragment>);
}

export function ContentLinkEditor({ label, onChange, children }) {
  const container = useRef(null);
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const open = () => {
    const textbox = container.current.querySelector('[role="textbox"]');
    const source = textbox.textContent.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/, '');
    const selection = window.getSelection();
    let start = source.length;
    let end = start;
    if (selection?.rangeCount && textbox.contains(selection.anchorNode) && textbox.contains(selection.focusNode)) {
      const range = selection.getRangeAt(0);
      const before = range.cloneRange();
      before.selectNodeContents(textbox);
      before.setEnd(range.startContainer, range.startOffset);
      start = before.toString().length;
      end = start + range.toString().length;
    }
    const existing = parseContentLinks(source).find((part) => part.url && start >= part.start && end <= part.end);
    setLink(existing
      ? { source, start: existing.start, end: existing.end, label: existing.text, url: existing.url, existing: true }
      : { source, start, end, label: source.slice(start, end), url: '', existing: false });
    setError('');
  };
  const apply = (remove = false) => {
    try {
      const textbox = container.current.querySelector('[role="textbox"]');
      const current = textbox.textContent.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/, '');
      if (current !== link.source) throw new Error('The text changed. Cancel and reopen the link editor to keep those changes.');
      const next = replaceContentLink(link.source, link.start, link.end, link.label, remove ? '' : link.url);
      if (!remove && !link.url) throw new Error('Enter a link destination.');
      textbox.textContent = next;
      onChange(next);
      setLink(null);
    } catch (cause) {
      setError(cause.message);
    }
  };
  return <span ref={container} className="ContentTextEditor">
    {children}
    <span data-editor-control="true" className="ContentLinkControls">
      <button type="button" className="EditorIconButton" aria-label={`Add or edit link in ${label}`} title="Select words, then add a link; place the cursor inside a link to edit it"
        onMouseDown={(event) => event.preventDefault()} onClick={open}><LinkIcon size={16} /></button>
      {link && <span className="ContentLinkForm" role="group" aria-label={`Link in ${label}`}>
        <label>Link text<input className="FormInput" value={link.label} onChange={(event) => setLink({ ...link, label: event.target.value })} /></label>
        <label>Destination<input className="FormInput" placeholder="/?page=beginners or https://…" value={link.url} onChange={(event) => setLink({ ...link, url: event.target.value })} /></label>
        <button type="button" className="EditorCommand" onClick={() => apply()}>Apply link</button>
        {link.existing && <button type="button" className="EditorCommand" onClick={() => apply(true)}>Remove link</button>}
        <button type="button" className="EditorCommand" onClick={() => setLink(null)}>Cancel</button>
        {error && <span className="EditorError" role="alert">{error}</span>}
      </span>}
    </span>
  </span>;
}
