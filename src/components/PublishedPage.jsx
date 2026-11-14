import React from 'react';
import { usePageContent } from '../utils/PageContentContext';
import { PAGE_TILE_GROUPS, safeTileUrl, tileAppearanceClass, tileIsWide } from '../utils/pageTiles';
import { ContentText } from './ContentText';
import PageBanner from './PageBanner';
import ResponsiveImage from './ResponsiveImage';

const TileButton = ({ button }) => button && safeTileUrl(button.url)
  ? <a className="PrimaryActionButton PushBottom" href={safeTileUrl(button.url)}>{button.label}</a>
  : null;

const hasButton = (node) => React.isValidElement(node) && (node.props.className?.split(' ').includes('PrimaryActionButton')
  || React.Children.toArray(node.props.children).some(hasButton));

const publicInline = (node, copy, tile, inLink = false) => {
  if (!React.isValidElement(node)) return node;
  const isLink = inLink || node.type === 'a' || node.type === 'button';
  if (node.props.className?.split(' ').includes('PrimaryActionButton') && tile.button !== undefined) return <TileButton button={tile.button} />;
  const key = node.props['data-content-field'];
  const descriptiveField = key && !/title|heading|eyebrow|url|action|link|label$/i.test(key);
  if (descriptiveField && !isLink) return React.cloneElement(node, {}, <ContentText value={copy[key] || ''} />);
  if (typeof node.type !== 'string' && node.type !== React.Fragment) return node;
  const href = node.props.href ? safeTileUrl(node.props.href) : '';
  return React.cloneElement(node, href ? { href, ...(href.startsWith('/') ? { target: undefined, rel: undefined } : {}) } : {},
    React.Children.map(node.props.children, (child) => publicInline(child, copy, tile, isLink)));
};

function customTile(pageId, tile, number) {
  const templateClass = pageId === 'home' && tile.group === 'quick' ? 'shop_product_tile'
    : ['hero', 'mission', 'supporters', 'location', 'ways'].includes(tile.group) ? 'main_tile main_tile_grey main_tile_flex'
      : 'main_tile main_tile_flex';
  const imageUrl = safeTileUrl(tile.imageUrl, true);
  return <div key={tile.id} className={`tile_editor ${tileAppearanceClass(tile)} ${tileIsWide(tile) ? 'tile_width_full' : ''}`} data-tile-id={tile.id}>
    <div className={templateClass}>
      {tile.eyebrow && <span className="tile_eyebrow">{tile.eyebrow}</span>}
      <h3 className="tile_heading_bold_2">{tile.title}</h3>
      {tile.type === 'image' && imageUrl && <ResponsiveImage className="main_tile_image SpaceT4" src={imageUrl} sources={tile.imageSources} placeholder={tile.imagePlaceholder} alt={tile.alt || ''} fit="contain" />}
      {tile.description && <p className="text_container AdminPreserveLines SpaceT4 SpaceB4"><ContentText value={tile.description} /></p>}
      {tile.button !== undefined ? <TileButton button={tile.button} />
        : tile.type === 'link' && <a className="PrimaryActionButton PushBottom" href={safeTileUrl(tile.url) || undefined}>{tile.action}</a>}
    </div>
  </div>;
}

export default function PublishedPage({ pageId, children, toolbar }) {
  const copy = usePageContent(pageId);
  const originals = new Map();
  const collect = (node) => {
    if (!React.isValidElement(node)) return;
    if (node.props['data-tile-id']) { originals.set(node.props['data-tile-id'], node); return; }
    React.Children.forEach(node.props.children, collect);
  };
  React.Children.forEach(children, collect);
  const tiles = Array.isArray(copy.tileLayout) ? copy.tileLayout : [];
  const ordered = Object.keys(PAGE_TILE_GROUPS[pageId] || {}).flatMap((group) => tiles.filter((tile) => tile.group === group));
  const numbers = new Map(ordered.map((tile, index) => [tile.id, index + 1]));

  const renderTile = (tile) => {
    const number = numbers.get(tile.id);
    if (tile.type !== 'existing') return customTile(pageId, tile, number);
    const original = originals.get(tile.id);
    if (!original) return null;
    let content = publicInline(original, copy, tile);
    if (tile.button && !hasButton(original)) content = React.cloneElement(content, {}, content.props.children, <TileButton button={tile.button} />);
    return <div key={tile.id} className={`tile_editor ${tileAppearanceClass(tile)} ${tileIsWide(tile, original.props.className?.includes('tile_width_full')) ? 'tile_width_full' : ''}`} data-tile-id={tile.id}>{content}</div>;
  };
  const render = (node) => {
    if (!React.isValidElement(node)) return node;
    const group = node.props['data-tile-group'];
    if (group) return <div key={group} className={node.props.className || 'tile_group_single'}>{tiles.filter((tile) => tile.group === group).map(renderTile)}</div>;
    if (typeof node.type !== 'string' && node.type !== React.Fragment) return node;
    return React.cloneElement(node, {}, React.Children.map(node.props.children, render));
  };

  return <div className={`PageFadeIn EditablePage ${safeTileUrl(copy.banner?.imageUrl, true) ? 'HasBanner' : ''}`}>
    {toolbar}
    <PageBanner pageId={pageId} />
    <div>{React.Children.map(children, render)}</div>
  </div>;
}

export function PublishedSupporterTiles() {
  const copy = usePageContent('home');
  const tiles = copy.supporterTiles || [];
  return <div className="sponsor_grid">
    {tiles.map((tile) => {
      const imageUrl = safeTileUrl(tile.imageUrl, true);
      return <div key={tile.id} className={`tile_editor sponsor_editor_tile ${tileAppearanceClass(tile)}`} data-tile-id={tile.id}>
        <a className="sponsor_subtile" href={safeTileUrl(tile.url) || undefined} target="_blank" rel="noreferrer" aria-label={imageUrl ? tile.name : undefined}>
          {imageUrl ? <ResponsiveImage className="sponsor_logo" src={imageUrl} sources={tile.imageSources} placeholder={tile.imagePlaceholder} alt={tile.alt || tile.name} fit="contain" />
            : <span className="sponsor_name">{tile.name}</span>}
        </a>
      </div>;
    })}
  </div>;
}
