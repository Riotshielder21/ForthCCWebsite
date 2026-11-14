import React, { lazy, Suspense } from 'react';
import { usePageEditor } from '../utils/PageContentContext';
import PageEditorToolbar from './PageEditorToolbar';
import PublishedPage, { PublishedSupporterTiles } from './PublishedPage';

const EditablePageEditor = lazy(() => import('./EditablePageEditor'));
const EditableSupporterTiles = lazy(() => import('./EditablePageEditor').then((module) => ({ default: module.SupporterTiles })));

export default function EditablePage({ pageId, children }) {
  const editor = usePageEditor();
  if (editor.adminUser && editor.editMode) return <Suspense fallback={<PublishedPage pageId={pageId} toolbar={<PageEditorToolbar pageId={pageId} />}>{children}</PublishedPage>}>
    <EditablePageEditor pageId={pageId}>{children}</EditablePageEditor>
  </Suspense>;
  return <PublishedPage pageId={pageId} toolbar={<PageEditorToolbar pageId={pageId} />}>{children}</PublishedPage>;
}

export function SupporterTiles() {
  const editor = usePageEditor();
  if (editor.adminUser && editor.editMode) return <Suspense fallback={<PublishedSupporterTiles />}><EditableSupporterTiles /></Suspense>;
  return <PublishedSupporterTiles />;
}
