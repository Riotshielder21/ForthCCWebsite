import React, { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { adminListPageSize, listPage } from '../utils/listPaging';

export default function PagedAdminList({ items, label, renderItem, renderPage }) {
  const [pageSize, setPageSize] = useState(() => adminListPageSize(window.innerHeight));
  const [requestedStart, setRequestedStart] = useState(0);
  const [direction, setDirection] = useState('down');
  const listId = useId();
  const { start, end, hasPrevious, hasMore } = listPage(items.length, pageSize, requestedStart);
  const paged = items.length > pageSize;

  useEffect(() => {
    const resize = () => setPageSize(adminListPageSize(window.innerHeight));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => { setRequestedStart(start); }, [start]);

  const move = (step) => {
    setDirection(step < 0 ? 'up' : 'down');
    setRequestedStart(start + step * pageSize);
  };

  return (
    <div className="AdminPagedList" role="group" aria-label={label} data-direction={direction}
      style={{ '--admin-list-page-size': paged ? pageSize : 0 }}>
      {paged && <div className="AdminPagedListHeader">
        <button type="button" className="AdminPageButton" disabled={!hasPrevious} onClick={() => move(-1)}
          aria-label={`Previous ${label}`} aria-controls={listId}><ChevronUp className="IconMd" /> Up</button>
        <span className="AdminPageRange" role="status">{start + 1}&ndash;{end} of {items.length}</span>
      </div>}
      <div id={listId} className="AdminPagedListItems">
        <div className="AdminPagedListBatch" key={start}>
          {renderPage ? renderPage(items.slice(start, end)) : items.slice(start, end).map(renderItem)}
        </div>
      </div>
      {paged && <button type="button" className="AdminPageButton AdminPageMore" disabled={!hasMore} onClick={() => move(1)}
        aria-label={`More ${label}`} aria-controls={listId}>More <ChevronDown className="IconMd" /></button>}
    </div>
  );
}
