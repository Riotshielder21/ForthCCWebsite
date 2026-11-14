import React from 'react';
import { parseContentLinks, safeTileUrl } from '../utils/contentLinks';

export function ContentText({ value }) {
  return parseContentLinks(value).map((part) => part.url && safeTileUrl(part.url)
    ? <a key={part.start} href={safeTileUrl(part.url)} target={/^https:\/\//i.test(safeTileUrl(part.url)) ? '_blank' : undefined}
      rel={/^https:\/\//i.test(safeTileUrl(part.url)) ? 'noreferrer' : undefined}>{part.text}</a>
    : <React.Fragment key={part.start}>{part.url ? value.slice(part.start, part.end) : part.text}</React.Fragment>);
}
