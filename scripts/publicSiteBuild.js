import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_ROUTES, relativeClubLink } from '../src/utils/routes.js';

const publicPageNames = ['HomePage', 'MembershipPage', 'BeginnersPage', 'DisciplinesPage', 'VolunteeringPage', 'AboutPage', 'ContactUsPage', 'AccessProjectPage'];
const contentIds = Object.values(PUBLIC_ROUTES).map((route) => route.content).filter(Boolean);

function localImages(directory, root = directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? localImages(path, root)
      : /\.(webp|png|jpe?g|svg)$/i.test(entry.name) ? [`/images/${path.slice(root.length + 1)}`] : [];
  });
}

function publishedImages(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, field]) => {
    if (['imageUrl', 'bannerUrl'].includes(key) && typeof field === 'string' && field) {
      const url = relativeClubLink(field);
      return new URL(url, 'https://forthcanoeclub.co.uk').protocol === 'https:' ? [url] : [];
    }
    return publishedImages(field);
  });
}

export default function publicSiteBuild() {
  return {
    name: 'public-site-offline-build',
    enforce: 'post',
    generateBundle() {
      for (const id of contentIds) {
        const name = `content/pages/${id}.json`;
        if (!existsSync(join('public', name))) this.emitFile({ type: 'asset', fileName: name, source: '{}' });
      }
    },
    writeBundle(options, bundle) {
      const files = new Set(['/index.html']);
      const include = (file) => {
        if (files.has(`/${file}`)) return;
        files.add(`/${file}`);
        const chunk = bundle[file];
        if (chunk?.type === 'chunk') {
          chunk.imports.forEach(include);
          chunk.viteMetadata?.importedCss.forEach(include);
          chunk.viteMetadata?.importedAssets.forEach(include);
        }
      };
      Object.values(bundle).filter((file) => file.type === 'chunk' && file.isEntry).forEach((file) => include(file.fileName));
      for (const name of publicPageNames) {
        Object.values(bundle).filter((file) => file.type === 'chunk' && file.name === name).forEach((file) => include(file.fileName));
      }
      const imageUrls = new Set(localImages('public/images'));
      for (const id of contentIds) {
        const name = `content/pages/${id}.json`;
        const path = join('public', name);
        const source = existsSync(path) ? readFileSync(path, 'utf8') : '{}';
        files.add(`/${name}`);
        publishedImages(JSON.parse(source)).forEach((value) => imageUrls.add(value));
      }
      ['/crest-favicon.png', '/crest-blue-logo.png'].filter((path) => existsSync(`public${path}`)).forEach((path) => files.add(path));
      const workerSource = readFileSync('src/service-worker.js', 'utf8');
      const digests = {};
      for (const file of [...files, ...imageUrls]) {
        const outputPath = join(options.dir, file.slice(1));
        const source = file.startsWith('/') && existsSync(outputPath) ? readFileSync(outputPath) : null;
        if (source !== null) digests[file] = createHash('sha256').update(source).digest('hex');
      }
      const version = createHash('sha256').update(workerSource).update(JSON.stringify({ files: [...files], images: [...imageUrls], digests })).digest('hex').slice(0, 16);
      const manifest = { version, files: [...files], images: [...imageUrls], digests, paths: Object.values(PUBLIC_ROUTES).map((route) => route.path) };
      writeFileSync(join(options.dir, 'sw.js'), workerSource.replace('__PUBLIC_SITE_MANIFEST__', JSON.stringify(manifest)));
    }
  };
}
