import React, { useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Minus, Plus, Settings, Type, ImagePlus, Link, Save, Send, Undo2, LogOut, ExternalLink } from 'lucide-react';
import { usePageContent, usePageEditor } from '../utils/PageContentContext';
import { PAGE_TILE_GROUPS, moveTile, safeTileUrl, TILE_APPEARANCES, TILE_WIDTHS, tileAppearanceClass, tileIsWide } from '../utils/pageTiles';
import { uploadPageImage } from '../utils/content';

const fieldName = (key) => /title|heading/i.test(key) ? 'title'
  : /eyebrow/i.test(key) ? 'label'
    : /url/i.test(key) ? 'link URL'
      : /action|link|label$/i.test(key) ? 'link text' : 'description';

export function InlineText({ value, label, onChange, multiline = true }) {
  return (
    <span className="text_inline_editor" role="textbox" aria-label={label} aria-multiline={multiline}
      contentEditable suppressContentEditableWarning tabIndex={0} data-placeholder={label}
      onBlur={(event) => {
        const previousTransform = event.currentTarget.style.textTransform;
        event.currentTarget.style.textTransform = 'none';
        const next = event.currentTarget.innerText.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/, '');
        event.currentTarget.style.textTransform = previousTransform;
        if (next !== value) onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !multiline) { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.currentTarget.textContent = value; event.currentTarget.blur(); }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const text = event.clipboardData.getData('text/plain');
        const node = document.createTextNode(multiline ? text : text.replace(/\n/g, ' '));
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }}
    >{value}</span>
  );
}

export function PageEditorToolbar({ pageId }) {
  const editor = usePageEditor();
  if (!editor.adminUser) return null;
  return (
    <div className="PageEditorToolbar" data-editor-control="true">
      <label className="EditorModeSwitch"><input type="checkbox" checked={editor.editMode} onChange={(event) => editor.setEditMode(event.target.checked)} /> Edit Mode</label>
      {editor.editMode && <>
        <button className="EditorCommand" disabled={editor.busy} onClick={() => editor.save(pageId)}><Save size={18} /> Save draft</button>
        <button className="EditorCommand EditorPublish" disabled={editor.busy} onClick={() => editor.save(pageId, true)}><Send size={18} /> Publish for review</button>
        <button className="EditorIconButton" title="Discard local page changes" aria-label="Discard local page changes" disabled={editor.busy} onClick={() => editor.discard(pageId)}><Undo2 size={18} /></button>
      </>}
      <button className="EditorIconButton" title="Sign out" aria-label="Sign out" onClick={() => editor.logout().catch(() => window.alert('Sign-out failed. Please try again.'))}><LogOut size={18} /></button>
      {(editor.message || editor.error || editor.busy || editor.drafts[pageId]) && <span className={editor.error ? 'EditorStatus EditorError' : 'EditorStatus'} role="status">{editor.busy ? 'Saving…' : editor.error || editor.message || 'Local draft (not published)'}</span>}
      {editor.review?.url && <a className="ContentLink" target="_blank" rel="noreferrer" href={editor.review.url}>Review #{editor.review.number} <ExternalLink size={14} /></a>}
    </div>
  );
}

function TileGroup({ id, className, children, onAdd }) {
  const [adding, setAdding] = useState(false);
  const editor = usePageEditor();
  const { setNodeRef, isOver } = useDroppable({ id: `group:${id}` });
  return (
    <div ref={setNodeRef} className={`${className || 'tile_group_single'} ${isOver ? 'tile_group_drop_target' : ''}`}>
      {children}
      {editor.editMode && <div className="tile_add_area" data-editor-control="true">
        <button className="tile_add_button" title="Add tile" aria-label={`Add tile to ${id}`} aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus size={28} /></button>
        {adding && <div className="tile_type_menu" role="group" aria-label="New tile type">
          {[[Type, 'text'], [ImagePlus, 'image'], [Link, 'link']].map(([Icon, type]) => <button key={type} onClick={() => { onAdd(type); setAdding(false); }}><Icon size={18} /> {type}</button>)}
        </div>}
      </div>}
    </div>
  );
}

function TilePresentationSettings({ tile, label, onChange, allowWidth = true }) {
  return <div className="tile_presentation_settings">
    <fieldset className="tile_style_options"><legend>{label} style</legend>
      {TILE_APPEARANCES.map((appearance) => <label key={appearance} title={appearance === 'default' ? 'Use the page template style' : `${appearance} tile surface`}>
        <input type="radio" name={`${tile.id}-appearance`} value={appearance} checked={(tile.appearance || 'default') === appearance} onChange={() => onChange('appearance', appearance)} />
        <span className={`tile_style_swatch tile_style_swatch-${appearance}`} aria-hidden="true" />
        {appearance === 'default' ? 'Default' : appearance === 'white' ? 'White' : 'Grey'}
      </label>)}
    </fieldset>
    {allowWidth && <label className="FormLabel">{label} width<select className="FormInput" value={tile.width || 'default'} onChange={(event) => onChange('width', event.target.value)}>
      {TILE_WIDTHS.map((width) => <option value={width} key={width}>{width === 'default' ? 'Page template' : width === 'standard' ? 'Standard column' : 'Full section width'}</option>)}
    </select></label>}
  </div>;
}

function SortableTile({ tile, number, children, fullSpan, onDelete, settings, label = `Tile ${number}`, className = '', onPresentationChange, allowWidth = true }) {
  const editor = usePageEditor();
  const [configuring, setConfiguring] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id, disabled: !editor.editMode });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`tile_editor ${className} ${tileAppearanceClass(tile)} ${tileIsWide(tile, fullSpan) ? 'tile_width_full' : ''} ${editor.editMode ? 'tile_editor_active' : ''} ${isDragging ? 'tile_editor_dragging' : ''}`} data-tile-id={tile.id}>
      {editor.editMode && <div className="tile_editor_controls" data-editor-control="true">
        <span className="tile_editor_number">{label}</span>
        <button className="EditorIconButton tile_editor_drag_handle" title={`Drag ${label} to reorder`} aria-label={`Move ${label}`} {...attributes} {...listeners}><GripVertical size={18} /></button>
        <button className="EditorIconButton" title={`${label} settings`} aria-label={`${label} settings`} aria-expanded={configuring} onClick={() => setConfiguring(!configuring)}><Settings size={17} /></button>
        <button className="EditorIconButton TileRemove" title={`Remove ${label}`} aria-label={`Remove ${label}`} onClick={onDelete}><Minus size={20} /></button>
      </div>}
      {configuring && editor.editMode && <div className="tile_editor_settings" data-editor-control="true">
        {onPresentationChange && <TilePresentationSettings tile={tile} label={label} onChange={onPresentationChange} allowWidth={allowWidth} />}
        {settings}
      </div>}
      {children}
    </div>
  );
}

function SupporterTile({ tile, number, updateTile, onDelete }) {
  const editor = usePageEditor();
  const editing = Boolean(editor.adminUser && editor.editMode);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const imageUrl = safeTileUrl(tile.imageUrl, true);
  const settings = <>
    <label className="FormLabel">Supporter {number} name<input className="FormInput" value={tile.name} onChange={(event) => updateTile('name', event.target.value)} /></label>
    <label className="FormLabel">Website URL<input className="FormInput" value={tile.url} onChange={(event) => updateTile('url', event.target.value)} /></label>
    <label className="FormLabel">Logo URL<input className="FormInput" value={tile.imageUrl} onChange={(event) => updateTile('imageUrl', event.target.value)} /></label>
    <label className="FormLabel">Logo description<input className="FormInput" value={tile.alt} onChange={(event) => updateTile('alt', event.target.value)} /></label>
    <label className="FormLabel">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploading(true);
      setError('');
      try { updateTile('imageUrl', await uploadPageImage('home', tile.id, file)); }
      catch (uploadError) { setError(uploadError.message); }
      finally { setUploading(false); }
    }} /></label>
    {uploading && <span role="status">Uploading…</span>}
    {error && <span className="EditorError" role="alert">{error}</span>}
  </>;
  return <SortableTile tile={tile} number={number} label={`Supporter ${number}`} className="sponsor_editor_tile" settings={settings} onDelete={onDelete} onPresentationChange={updateTile} allowWidth={false}>
    <a className="sponsor_subtile" href={safeTileUrl(tile.url) || undefined} target="_blank" rel="noreferrer" aria-label={imageUrl ? tile.name : undefined}>
      {imageUrl ? <img className="sponsor_logo" src={imageUrl} alt={tile.alt || tile.name} />
        : <span className="sponsor_name">{editing ? <InlineText value={tile.name} label={`Supporter ${number} name`} multiline={false} onChange={(value) => updateTile('name', value)} /> : tile.name}</span>}
    </a>
  </SortableTile>;
}

export function SupporterTiles() {
  const copy = usePageContent('home');
  const editor = usePageEditor();
  const editing = Boolean(editor.adminUser && editor.editMode);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const tiles = copy.supporterTiles;
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (!editing || !over || active.id === over.id) return;
    editor.updatePage('home', (current) => {
      const next = [...current.supporterTiles];
      const from = next.findIndex((tile) => tile.id === active.id);
      const to = next.findIndex((tile) => tile.id === over.id);
      if (from < 0 || to < 0) return current;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...current, supporterTiles: next };
    });
  }}>
    <SortableContext items={tiles.map((tile) => tile.id)} strategy={rectSortingStrategy}>
      <div className={`sponsor_grid ${editing ? 'sponsor_grid_editing' : ''}`}>
        {tiles.map((tile, index) => <SupporterTile key={tile.id} tile={tile} number={index + 1}
          updateTile={(key, value) => editor.updatePage('home', (current) => ({ ...current,
            supporterTiles: current.supporterTiles.map((item) => item.id === tile.id ? { ...item, [key]: value } : item)
          }))}
          onDelete={() => {
            if (window.confirm(`Remove Supporter ${index + 1}? This change takes effect only after publishing.`)) {
              editor.updatePage('home', (current) => ({ ...current, supporterTiles: current.supporterTiles.filter((item) => item.id !== tile.id) }));
            }
          }} />)}
        {editing && <div className="tile_add_area" data-editor-control="true"><button className="tile_add_button" title="Add supporter" aria-label="Add supporter" disabled={tiles.length >= 100} onClick={() => editor.updatePage('home', (current) => ({ ...current,
          supporterTiles: [...current.supporterTiles, { id: `supporter-${crypto.randomUUID()}`, name: 'New supporter', url: '', imageUrl: '', alt: '' }]
        }))}><Plus size={28} /></button></div>}
      </div>
    </SortableContext>
  </DndContext>;
}

function CustomTile({ pageId, tile, number, updateTile, onDelete }) {
  const editor = usePageEditor();
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const text = (key) => editor.editMode
    ? <InlineText value={tile[key] || ''} label={`Tile ${number} ${fieldName(key)}`} multiline={key === 'description'} onChange={(value) => updateTile(key, value)} />
    : tile[key];
  const settings = <>
    <label className="FormLabel">Tile {number} type<select className="FormInput" value={tile.type} onChange={(event) => updateTile('type', event.target.value)}>{['text', 'image', 'link'].map((type) => <option key={type}>{type}</option>)}</select></label>
    {tile.type === 'image' && <>
      <label className="FormLabel">Image URL<input className="FormInput" type="url" value={tile.imageUrl || ''} onChange={(event) => updateTile('imageUrl', event.target.value)} /></label>
      <label className="FormLabel">Image description<input className="FormInput" value={tile.alt || ''} onChange={(event) => updateTile('alt', event.target.value)} /></label>
      <label className="FormLabel">Upload image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setUploadError('');
        setUploading(true);
        try { updateTile('imageUrl', await uploadPageImage(pageId, tile.id, file)); }
        catch (error) { setUploadError(error.message); }
        finally { setUploading(false); }
      }} /></label>
      {uploading && <p role="status">Uploading…</p>}
      {uploadError && <p className="EditorError" role="alert">{uploadError}</p>}
    </>}
    {tile.type === 'link' && <label className="FormLabel">Link URL<input className="FormInput" value={tile.url || ''} onChange={(event) => updateTile('url', event.target.value)} /></label>}
  </>;
  const templateClass = pageId === 'home' && tile.group === 'quick' ? 'shop_product_tile'
    : ['hero', 'mission', 'supporters', 'location', 'ways'].includes(tile.group) ? 'main_tile main_tile_grey main_tile_flex'
      : 'main_tile main_tile_flex';
  return <SortableTile tile={tile} number={number} onDelete={onDelete} settings={settings} onPresentationChange={updateTile}><div className={templateClass}>
    {(tile.eyebrow || editor.editMode) && <span className="tile_eyebrow">{text('eyebrow')}</span>}
    <h3 className="tile_heading_bold_2">{text('title')}</h3>
    {tile.type === 'image' && (safeTileUrl(tile.imageUrl, true)
      ? <img className="main_tile_image SpaceT4" src={safeTileUrl(tile.imageUrl, true)} alt={tile.alt || ''} />
      : editor.editMode && <button className="tile_image_placeholder" data-editor-control="true" onClick={() => document.querySelector(`[data-tile-id="${tile.id}"] .tile_editor_controls button[aria-expanded]`)?.click()} aria-label={`Configure Tile ${number} image`}><ImagePlus size={36} /></button>)}
    <p className="text_container AdminPreserveLines SpaceT4 SpaceB4">{text('description')}</p>
    {tile.type === 'link' && <a className="PrimaryActionButton PushBottom" href={safeTileUrl(tile.url) || undefined}>{text('action')} <ExternalLink size={16} /></a>}
  </div></SortableTile>;
}

export default function EditablePage({ pageId, children }) {
  const copy = usePageContent(pageId);
  const editor = usePageEditor();
  const editing = Boolean(editor.adminUser && editor.editMode);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const originals = new Map();
  const collect = (node) => {
    if (!React.isValidElement(node)) return;
    if (node.props['data-tile-id']) { originals.set(node.props['data-tile-id'], node); return; }
    React.Children.forEach(node.props.children, collect);
  };
  React.Children.forEach(children, collect);
  const tiles = Array.isArray(copy.tileLayout) ? copy.tileLayout : [];
  const ordered = Object.keys(PAGE_TILE_GROUPS[pageId]).flatMap((group) => tiles.filter((tile) => tile.group === group));
  const numbers = new Map(ordered.map((tile, index) => [tile.id, index + 1]));
  const updateLayout = (next) => editor.updatePage(pageId, { ...copy, tileLayout: next });
  const updateField = (key, value) => editor.updatePage(pageId, (current) => ({ ...current, [key]: value }));
  const inline = (node, number, fields) => {
    if (!React.isValidElement(node)) return node;
    if (node.props['data-link-field']) fields.add(node.props['data-link-field']);
    const key = node.props['data-content-field'];
    if (key) {
      fields.add(key);
      const label = /^h[1-6]$/.test(node.type) ? 'title' : fieldName(key);
      if (editing) return React.cloneElement(node, node.props.href ? { href: safeTileUrl(node.props.href) || undefined } : {}, <InlineText value={copy[key] || ''} label={`Tile ${number} ${label}`} multiline={label === 'description'} onChange={(value) => updateField(key, value)} />);
    }
    if (typeof node.type !== 'string' && node.type !== React.Fragment) return node;
    return React.cloneElement(node, node.props.href ? { href: safeTileUrl(node.props.href) || undefined } : {}, React.Children.map(node.props.children, (child) => inline(child, number, fields)));
  };
  const renderTile = (tile) => {
    const number = numbers.get(tile.id);
    const onDelete = () => {
      if (window.confirm(`Remove Tile ${number}? This change takes effect only after publishing.`)) updateLayout(tiles.filter((item) => item.id !== tile.id));
    };
    if (tile.type !== 'existing') return <CustomTile key={tile.id} tile={tile} pageId={pageId} number={number} onDelete={onDelete}
      updateTile={(key, value) => editor.updatePage(pageId, (current) => ({
        ...current,
        tileLayout: current.tileLayout.map((item) => item.id === tile.id ? { ...item, [key]: value } : item)
      }))} />;
    const original = originals.get(tile.id);
    if (!original) return null;
    const fields = new Set();
    const content = inline(original, number, fields);
    const settings = <>
      {[...fields].filter((key) => /url$/i.test(key)).map((key) => <label key={key} className="FormLabel">Tile {number} {fieldName(key)}<input className="FormInput" value={copy[key]} onChange={(event) => updateField(key, event.target.value)} /></label>)}
    </>;
    return <SortableTile key={tile.id} tile={tile} number={number} onDelete={onDelete} settings={settings} fullSpan={original.props.className?.includes('tile_width_full')}
      onPresentationChange={(key, value) => editor.updatePage(pageId, (current) => ({ ...current,
        tileLayout: current.tileLayout.map((item) => item.id === tile.id ? { ...item, [key]: value } : item)
      }))}>{content}</SortableTile>;
  };
  const render = (node) => {
    if (!React.isValidElement(node)) return node;
    const group = node.props['data-tile-group'];
    if (group) return <TileGroup key={group} id={group} className={node.props.className} onAdd={(type) => {
      updateLayout([...tiles, { id: `new-${crypto.randomUUID()}`, group, type, title: 'New tile', description: '', eyebrow: '', action: 'Open link', url: '', imageUrl: '', alt: '' }]);
    }}>{tiles.filter((tile) => tile.group === group).map(renderTile)}</TileGroup>;
    if (typeof node.type !== 'string' && node.type !== React.Fragment) return node;
    return React.cloneElement(node, {}, React.Children.map(node.props.children, render));
  };
  return <div className="PageFadeIn EditablePage">
    <PageEditorToolbar pageId={pageId} />
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
      if (!editing || !over) return;
      if (String(over.id).startsWith('group:')) {
        const activeTile = tiles.find((tile) => tile.id === active.id);
        if (activeTile) updateLayout([...tiles.filter((tile) => tile.id !== active.id), { ...activeTile, group: String(over.id).slice(6) }]);
      } else updateLayout(moveTile(tiles, active.id, over.id));
    }}>
      <SortableContext items={ordered.map((tile) => tile.id)} strategy={rectSortingStrategy}>
        <div className={editing ? 'page_edit_canvas' : undefined} onClickCapture={(event) => {
          if (editing && !event.target.closest('[data-editor-control]') && event.target.closest('a, button')) { event.preventDefault(); event.stopPropagation(); }
        }}>{React.Children.map(children, render)}</div>
      </SortableContext>
    </DndContext>
  </div>;
}