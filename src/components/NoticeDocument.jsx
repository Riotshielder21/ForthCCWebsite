import React from 'react';
import { ContentText } from './ContentText';
import { parseNoticeBlocks } from '../utils/notices';

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

/**
 * A tick box for a versioned statement: the short statement beside the box and its full wording one click away,
 * with a link to the same wording on the Notices page.
 */
export function PolicyTick({ wording, checked, onChange, required = false, disabled = false }) {
  return <div className="PolicyTick">
    <label className="CheckoutCheck"><input type="checkbox" checked={checked} required={required} disabled={disabled} onChange={onChange} /> <span>{wording.label}</span></label>
    <details className="PolicyTickView">
      <summary>View the {wording.title}</summary>
      <div className="PolicyTickBody">
        <NoticeDocument body={wording.body} />
        <p className="CartItemMeta SpaceT2"><a href={`/notices#${wording.id}`} target="_blank" rel="noopener">Open on the Notices page</a></p>
      </div>
    </details>
  </div>;
}
