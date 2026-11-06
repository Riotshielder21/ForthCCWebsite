import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_PRESETS, MAX_IMAGE_SOURCES, chooseImageSource, plannedWidths, requiredImageWidth,
  usableImageSources, usablePlaceholder, validateImagePlaceholder, validateImageSources
} from './responsiveImages.js';

const url = (width) => `https://firebasestorage.googleapis.com/v0/b/x/o/a-${width}.webp?alt=media&token=abc`;
const ladder = IMAGE_PRESETS.banner.widths.map((width) => ({ url: url(width), width, height: Math.round(width / 1.5) }));

test('planned sizes never enlarge the photo and always include its own width', () => {
  assert.deepEqual(plannedWidths(6000, IMAGE_PRESETS.banner.widths), IMAGE_PRESETS.banner.widths);
  assert.deepEqual(plannedWidths(1152, IMAGE_PRESETS.banner.widths), [640, 960, 1152]);
  assert.deepEqual(plannedWidths(500, IMAGE_PRESETS.content.widths), [320, 480, 500]);
  assert.deepEqual(plannedWidths(100, IMAGE_PRESETS.logo.widths), [100]);
  assert.deepEqual(plannedWidths(0, IMAGE_PRESETS.logo.widths), []);
  for (const preset of Object.values(IMAGE_PRESETS)) assert.ok(preset.widths.length + 1 <= MAX_IMAGE_SOURCES);
});

test('needed width follows the box, the pixel density and cover cropping', () => {
  assert.equal(requiredImageWidth({ boxWidth: 1920, boxHeight: 640, aspect: 1.5, pixelRatio: 1 }), 1920, '1080p desktop banner');
  assert.equal(requiredImageWidth({ boxWidth: 2560, boxHeight: 640, aspect: 1.5, pixelRatio: 1 }), 2560, '1440p desktop banner');
  assert.equal(requiredImageWidth({ boxWidth: 390, boxHeight: 523, aspect: 1.5, pixelRatio: 3 }), 1569, 'phone banner is cropped wider and capped at 2x');
  assert.equal(requiredImageWidth({ boxWidth: 1920, boxHeight: 640, aspect: 1.5, pixelRatio: 2 }), 3840, '4K screen');
  assert.equal(requiredImageWidth({ boxWidth: 300, boxHeight: 50, aspect: 4, fit: 'contain', pixelRatio: 2 }), 400, 'logo limited by its height');
  assert.equal(requiredImageWidth({ boxWidth: 0, boxHeight: 50, aspect: 3, fit: 'contain', pixelRatio: 1 }), 150, 'auto-width logo');
  assert.equal(requiredImageWidth({ boxWidth: 400, boxHeight: 300, aspect: 1.5, fit: 'contain', pixelRatio: 0.5 }), 400, 'zoomed out still uses 1x');
});

test('the smallest stored size that fills the box is chosen', () => {
  assert.equal(chooseImageSource(ladder, 1569).width, 1600);
  assert.equal(chooseImageSource(ladder, 1920).width, 1920);
  assert.equal(chooseImageSource(ladder, 10000).width, 3840);
  assert.equal(chooseImageSource(ladder, 1).width, 640);
});

test('stored sizes must be secure, plain links with whole-number sizes', () => {
  assert.deepEqual(validateImageSources(undefined), []);
  assert.deepEqual(validateImageSources([...ladder].reverse()).map((source) => source.width), IMAGE_PRESETS.banner.widths);
  assert.deepEqual(validateImageSources([{ url: '/images/a.webp', width: 10, height: 10 }]), [{ url: '/images/a.webp', width: 10, height: 10 }]);
  for (const bad of ['x', {}, [null], [{ url: url(1), width: 0, height: 1 }], [{ url: url(1), width: 1, height: 10001 }],
    [{ url: 'http://example.com/a.webp', width: 1, height: 1 }], [{ url: 'javascript:alert(1)', width: 1, height: 1 }],
    [{ url: 'https://example.com/a b.webp', width: 1, height: 1 }], [{ url: 'https://example.com/a").webp', width: 1, height: 1 }],
    [{ url: url(1), width: 1, height: 1 }, { url: url(2), width: 1, height: 1 }],
    Array.from({ length: MAX_IMAGE_SOURCES + 1 }, (_, index) => ({ url: url(index), width: index + 1, height: 1 }))]) {
    assert.throws(() => validateImageSources(bad), /Invalid image sizes/);
  }
  assert.deepEqual(usableImageSources('x'), [], 'rendering falls back instead of failing');
});

test('previews must be small base64 raster images', () => {
  assert.equal(validateImagePlaceholder(undefined), '');
  assert.equal(validateImagePlaceholder('data:image/jpeg;base64,/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'https://example.com/a.webp',
    'data:image/webp;base64,AA")', `data:image/webp;base64,${'A'.repeat(4000)}`, 5]) {
    assert.throws(() => validateImagePlaceholder(bad), /Invalid image preview/);
  }
  assert.equal(usablePlaceholder('data:image/svg+xml;base64,PHN2Zz4='), '');
});
