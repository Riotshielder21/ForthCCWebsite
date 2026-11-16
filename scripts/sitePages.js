import { pageMetadata, SITE_URL } from '../src/utils/pageMetadata.js';
import { PUBLIC_ROUTES } from '../src/utils/routes.js';

const escapeAttribute = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Public routes get their own HTML metadata; unknown routes use the same app with a noindex 404 shell. */
export function pageShell(source, page) {
  const metadata = pageMetadata(page);
  const head = [
    `<title>${escapeAttribute(metadata.title)}</title>`,
    `<meta name="description" content="${escapeAttribute(metadata.description)}">`,
    `<meta name="robots" content="${metadata.robots}">`,
    `<meta property="og:title" content="${escapeAttribute(metadata.title)}">`,
    `<meta property="og:description" content="${escapeAttribute(metadata.description)}">`,
    '<meta property="og:type" content="website">'
  ];
  if (metadata.canonical) head.push(
    `<link rel="canonical" href="${metadata.canonical}">`,
    `<meta property="og:url" content="${metadata.canonical}">`
  );
  return source.replace(/<title>[^<]*<\/title>/, '').replace(
    /<meta\b[^>]*(?:name="(?:description|robots)"|property="og:[^"]+")[^>]*>/g, ''
  ).replace(/<link\b[^>]*rel="canonical"[^>]*>/g, '').replace('</head>', `${head.join('\n    ')}\n  </head>`);
}

export function sitemapXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    Object.values(PUBLIC_ROUTES).map(({ path }) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join('\n')
  }\n</urlset>\n`;
}
