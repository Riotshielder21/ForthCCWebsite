import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chooseImageSource, priorityImageWidth, requiredImageWidth, usableImageSources, usablePlaceholder } from '../utils/responsiveImages';
import { safeTileUrl } from '../utils/contentLinks';

/**
 * Shows an uploaded image at the smallest stored size that fills its box on this screen (box width × pixel density,
 * capped at 2x). A tiny blurred preview shows instantly; the chosen size draws over it once downloaded. If the box
 * later grows, for example when a window is maximised, a larger size replaces it; it never steps down.
 * Images without stored sizes (typed-in links, older uploads) load their single link as before.
 */
export default function ResponsiveImage({ src, sources, placeholder, alt = '', className = '', fit = 'cover', priority = false, style }) {
  const ref = useRef(null);
  const fallback = safeTileUrl(src, true);
  const list = useMemo(() => usableImageSources(sources), [sources]);
  const preview = usablePlaceholder(placeholder);
  const largest = list.at(-1);
  const setKey = `${fallback}|${list.map((source) => source.url).join('|')}`;
  const [current, setCurrent] = useState(() => (list.length ? '' : fallback));
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    setLoaded(false);
    if (!list.length) { setCurrent(fallback); return undefined; }
    const element = ref.current;
    let chosenWidth = 0;
    const pick = () => {
      // Offline, only the fallback copy was saved for reading without a connection.
      if (navigator.onLine === false && fallback) { setCurrent(fallback); return; }
      const box = element.getBoundingClientRect();
      if (!box.width && !box.height) return;
      const needed = requiredImageWidth({ boxWidth: box.width, boxHeight: box.height, aspect: largest.width / largest.height, fit, pixelRatio: window.devicePixelRatio });
      const next = chooseImageSource(list, priority ? priorityImageWidth(needed) : needed);
      if (next.width > chosenWidth) {
        chosenWidth = next.width;
        setCurrent(next.url);
      }
    };
    pick();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(pick);
    observer.observe(element);
    return () => observer.disconnect();
  }, [setKey, fit, priority]);

  if (!fallback && !list.length) return null;
  const showPreview = preview && !loaded;
  return <img
    ref={ref}
    className={`${className} ResponsiveImage ResponsiveImage-${fit === 'contain' ? 'contain' : 'cover'} ${showPreview ? 'ResponsiveImagePreview' : ''}`.trim()}
    src={current || undefined}
    alt={alt}
    loading={priority ? 'eager' : 'lazy'}
    fetchpriority={priority ? 'high' : undefined}
    decoding="async"
    style={showPreview ? { ...style, backgroundImage: `url("${preview}")` } : style}
    onLoad={() => setLoaded(true)}
    onError={() => { if (current && current !== fallback && fallback) setCurrent(fallback); }}
  />;
}
