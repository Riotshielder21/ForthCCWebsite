import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { getPageCopy } from '../constants/pageContent.js';

test('published content renders safe inline links and configurable buttons without nested anchors', async () => {
  const vite = await createServer({
    configFile: false,
    envFile: false,
    plugins: [react()],
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { __firebase_config: JSON.stringify(JSON.stringify({ apiKey: 'render-test', projectId: 'demo-fcc' })) }
  });
  try {
    const { ContentText } = await vite.ssrLoadModule('/src/components/ContentText.jsx');
    const { PageContentProvider } = await vite.ssrLoadModule('/src/utils/PageContentContext.jsx');
    const { default: HomePage } = await vite.ssrLoadModule('/src/pages/HomePage.jsx');
    const renderHome = (saved) => renderToStaticMarkup(React.createElement(PageContentProvider,
      { value: { home: getPageCopy('home', saved) } }, React.createElement(HomePage, { onNavigate: () => {} })));
    const inline = renderToStaticMarkup(React.createElement(ContentText, {
      value: '<script>bad</script> [classes](/?page=beginners) [bad](javascript:evil)'
    }));
    assert.match(inline, /&lt;script&gt;/);
    assert.match(inline, /<a href="\/\?page=beginners">classes<\/a>/);
    assert.doesNotMatch(inline, /href="javascript:/);
    const original = renderHome({});
    assert.match(original, /open nights<\/a>/);
    assert.match(original, /Beginners<\/span>/);
    const updated = renderHome({
      welcome1: 'Try [new classes](/?page=beginners).',
      tileLayout: [
        { id: 'welcome', group: 'intro', type: 'existing', button: { label: 'Choose a session', url: '/?page=beginners' } },
        { id: 'quick1', group: 'quick', type: 'existing', button: { label: 'Contact instead', url: '/?page=contact' } },
        { id: 'quick2', group: 'quick', type: 'existing', button: null },
        { id: 'new-image', group: 'quick', type: 'image', title: 'New image tile', description: '[Read more](/?page=about)',
          button: { label: 'Explore', url: '/?page=about' } }
      ]
    });
    assert.match(updated, /new classes<\/a>/);
    assert.match(updated, /Choose a session/);
    assert.match(updated, /Contact instead/);
    assert.match(updated, /Explore/);
    assert.doesNotMatch(updated, /data-content-field="quick1Action"/);
    assert.doesNotMatch(updated, /data-content-field="quick2Action"/);
    let anchorDepth = 0;
    for (const tag of updated.matchAll(/<\/?a\b[^>]*>/g)) {
      anchorDepth += tag[0].startsWith('</') ? -1 : 1;
      assert.ok(anchorDepth >= 0 && anchorDepth <= 1, 'anchors must not be nested');
    }
    assert.equal(anchorDepth, 0);
  } finally {
    await vite.close();
  }
});
