import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VOLUNTEER_PAGE, MAX_VOLUNTEER_OPPORTUNITIES, validateVolunteerPage, volunteerPageFromLegacy } from './volunteerPage.js';

test('volunteering wording and list round-trip with fixed form and layout', () => {
  assert.deepEqual(validateVolunteerPage(DEFAULT_VOLUNTEER_PAGE).value, DEFAULT_VOLUNTEER_PAGE);
  const content = { ...DEFAULT_VOLUNTEER_PAGE, title: ' Help the club ', opportunities: [{ title: ' Events ', description: ' Help out ' }] };
  assert.deepEqual(validateVolunteerPage(content).value.opportunities, [{ title: 'Events', description: 'Help out' }]);
  assert.equal(validateVolunteerPage(content).value.title, 'Help the club');
  assert.deepEqual(validateVolunteerPage({ ...content, opportunities: [] }).value.opportunities, []);
});

test('volunteering rejects configurable tiles, custom form fields and malformed or oversized content', () => {
  for (const change of [
    { tileLayout: [] }, { fields: ['New question'] }, { tiers: [] },
    { title: '' }, { waysTitle: ' ' }, { formTitle: ' ' }, { intro: null }, { intro: 'x'.repeat(2001) },
    { formDescription: 'x'.repeat(2001) }, { opportunities: null },
    { opportunities: Array(MAX_VOLUNTEER_OPPORTUNITIES + 1).fill({ title: 'Help', description: '' }) },
    { opportunities: [null] }, { opportunities: [{ title: '', description: '' }] },
    { opportunities: [{ title: 'x'.repeat(201), description: '' }] },
    { opportunities: [{ title: 'Help', description: 'x'.repeat(1001) }] },
    { opportunities: [{ title: 'Help', description: '', url: 'https://example.com' }] }
  ]) assert.ok(validateVolunteerPage({ ...DEFAULT_VOLUNTEER_PAGE, ...change }).error, JSON.stringify(change).slice(0, 100));
  for (const body of [null, [], 'invalid']) assert.ok(validateVolunteerPage(body).error);
});

test('old published wording migrates without tile layouts or custom form controls', () => {
  const content = volunteerPageFromLegacy({ title: 'Existing heading', intro: 'Existing introduction', waysList: 'Safety | Help | safely\n\nMaintenance | Paint',
    formTitle: 'Existing form', tileLayout: [{ id: 'extra', type: 'text' }], fields: ['Ignored'] });
  assert.equal(content.title, 'Existing heading');
  assert.equal(content.formTitle, 'Existing form');
  assert.equal(content.formDescription, DEFAULT_VOLUNTEER_PAGE.formDescription);
  assert.deepEqual(content.opportunities, [{ title: 'Safety', description: 'Help | safely' }, { title: 'Maintenance', description: 'Paint' }]);
  assert.equal(Object.hasOwn(content, 'tileLayout'), false);
  assert.deepEqual(volunteerPageFromLegacy({ waysList: '' }).opportunities, []);
  assert.deepEqual(volunteerPageFromLegacy(), DEFAULT_VOLUNTEER_PAGE);
});
