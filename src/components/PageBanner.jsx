import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, RotateCcw } from 'lucide-react';
import { usePageContent, usePageEditor } from '../utils/PageContentContext';
import { BANNER_FOCUS, DEFAULT_BANNERS, safeTileUrl } from '../utils/pageTiles';
import { uploadPageImage } from '../utils/content';

function BannerSettings({ pageId, banner }) {
  const editor = usePageEditor();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const update = (changes) => editor.updatePage(pageId, (current) => ({ ...current, banner: { ...current.banner, ...changes } }));
  return <fieldset className="PageBannerSettings" data-editor-control="true">
    <legend><ImagePlus size={16} /> Page banner</legend>
    <label className="FormLabel">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploading(true);
      setError('');
      try { update({ imageUrl: await uploadPageImage(pageId, 'banner', file) }); }
      catch (uploadError) { setError(uploadError.message); }
      finally { setUploading(false); }
    }} /></label>
    <label className="FormLabel">Photo URL<input className="FormInput" value={banner.imageUrl} onChange={(event) => update({ imageUrl: event.target.value })} /></label>
    <label className="FormLabel">Photo description<input className="FormInput" maxLength={300} placeholder="What the photo shows, for screen readers" value={banner.alt} onChange={(event) => update({ alt: event.target.value })} /></label>
    <label className="FormLabel">Photo credit<input className="FormInput" maxLength={120} placeholder="Shown as “Photo: …”" value={banner.credit} onChange={(event) => update({ credit: event.target.value })} /></label>
    <div className="PageBannerSettingsActions">
      {banner.imageUrl && <button type="button" className="EditorCommand" onClick={() => update({ imageUrl: '', alt: '', credit: '' })}><Trash2 size={16} /> Remove banner</button>}
      {DEFAULT_BANNERS[pageId] && banner.imageUrl !== DEFAULT_BANNERS[pageId].imageUrl
        && <button type="button" className="EditorCommand" onClick={() => update(DEFAULT_BANNERS[pageId])}><RotateCcw size={16} /> Use the original photo</button>}
    </div>
    {uploading && <span role="status">Uploading…</span>}
    {error && <span className="EditorError" role="alert">{error}</span>}
  </fieldset>;
}

/** A full-width photo under the navigation. The page's first tiles overlap it, and it fades as the page scrolls. */
export default function PageBanner({ pageId }) {
  const { banner } = usePageContent(pageId);
  const editor = usePageEditor();
  const ref = useRef(null);
  const imageUrl = safeTileUrl(banner?.imageUrl, true);
  const editing = Boolean(editor?.adminUser && editor.editMode);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const page = element.closest('.EditablePage');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    // The scroll position at which the first tiles sit just below the navigation and the photo has fully faded.
    const tilesTop = () => {
      const hero = page?.querySelector('.SectionHero');
      if (!hero) return element.offsetHeight * 0.8;
      const headerBottom = document.querySelector('.SiteHeader')?.getBoundingClientRect().bottom || 0;
      return Math.max(hero.getBoundingClientRect().top + window.scrollY - headerBottom - 16, 1);
    };
    let frame = 0;
    let heading = null;
    const update = () => {
      frame = 0;
      const progress = Math.min(Math.max(window.scrollY / tilesTop(), 0), 1);
      element.style.setProperty('--banner-progress', progress.toFixed(3));
      if (heading !== null && Math.abs(window.scrollY - heading) < 2) heading = null;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    // Until the tiles reach the navigation, each wheel notch moves a third of the way there; after that scrolling is normal.
    const onWheel = (event) => {
      if (event.deltaY < 0) heading = null;
      if (editing || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey
        || event.deltaY <= 0 || Math.abs(event.deltaX) > event.deltaY) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      for (let node = target; node && node !== page; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
      }
      const stop = tilesTop();
      const from = Math.max(window.scrollY, heading ?? 0);
      if (from >= stop - 1) return;
      const pixels = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaMode === 2 ? event.deltaY * window.innerHeight : event.deltaY;
      event.preventDefault();
      heading = Math.min(from + (stop / 3) * Math.min(pixels / 100, 1), stop);
      window.scrollTo({ top: heading, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    };
    update();
    page?.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      page?.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pageId, imageUrl, editing]);

  if (!banner) return null;
  return <>
    {editing && <BannerSettings pageId={pageId} banner={banner} />}
    {imageUrl && <div className="PageBanner" ref={ref} style={{ '--banner-focus': BANNER_FOCUS[banner.focus] || BANNER_FOCUS.center }}>
      <img className="PageBannerImage" src={imageUrl} alt={banner.alt} fetchpriority="high" decoding="async" />
      {banner.credit && <span className="PageBannerCredit">Photo: {banner.credit}</span>}
    </div>}
  </>;
}
