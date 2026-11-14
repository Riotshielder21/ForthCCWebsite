import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WELCOME_EMAIL, fillPlaceholders, renderWelcomeEmail, validateWelcomeDoc, validateWelcomeSubject, welcomeValuesFor, WELCOME_LIMITS } from './welcomeEmail.js';

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const doc = (...content) => ({ type: 'doc', content });
const paragraph = (...content) => ({ type: 'paragraph', content });

test('only allowlisted blocks, marks, attributes and link protocols survive validation', () => {
  const clean = validateWelcomeDoc(doc(
    { type: 'heading', attrs: { level: 6, style: 'x' }, content: [text('Hi')] },
    paragraph(text('Site', [{ type: 'link', attrs: { href: 'https://forthcanoeclub.co.uk', target: '_blank', onclick: 'x' } }]),
      text('Bad', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'bold' }, { type: 'textStyle', attrs: { color: 'red' } }]),
      text('Mail', [{ type: 'link', attrs: { href: 'mailto:hello@forthcanoeclub.co.uk' } }]))
  ));
  assert.deepEqual(clean.content[0], { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hi' }] });
  assert.deepEqual(clean.content[1].content.map((node) => node.marks), [
    [{ type: 'link', attrs: { href: 'https://forthcanoeclub.co.uk/' } }], [{ type: 'bold' }], [{ type: 'link', attrs: { href: 'mailto:hello@forthcanoeclub.co.uk' } }]
  ]);
  for (const bad of [doc({ type: 'image', attrs: { src: 'https://x.test/a.png' } }), doc(paragraph({ type: 'codeBlock' })), { type: 'paragraph' }, doc(), doc(paragraph())]) {
    assert.ok(validateWelcomeDoc(bad) instanceof Error);
  }
  assert.ok(validateWelcomeDoc(doc(paragraph(text('x'.repeat(WELCOME_LIMITS.text + 1))))) instanceof Error);
});

test('subjects are trimmed to one line and limited', () => {
  assert.equal(validateWelcomeSubject('  Welcome\n  aboard '), 'Welcome aboard');
  assert.ok(validateWelcomeSubject('') instanceof Error);
  assert.ok(validateWelcomeSubject('x'.repeat(WELCOME_LIMITS.subject + 1)) instanceof Error);
});

test('member details fill placeholders and are escaped, in HTML and the plain-text copy', () => {
  const template = { subject: 'Welcome {{firstName}}\n', doc: validateWelcomeDoc(doc(
    paragraph(text('Hi {{ firstName }}, {{unknown}} '), text('club', [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://club.test/?a=1&b="2"' } }])),
    { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('One'))] }, { type: 'listItem', content: [paragraph(text('Two'))] }] }
  )) };
  const email = renderWelcomeEmail(template, { firstName: '<img src=x onerror=alert(1)>' });
  assert.equal(email.subject, 'Welcome <img src=x onerror=alert(1)>');
  assert.doesNotMatch(email.html, /<img/);
  assert.match(email.html, /Hi &lt;img src=x onerror=alert\(1\)&gt;, \{\{unknown\}\}/);
  assert.match(email.html, /<a href="https:\/\/club\.test\/\?a=1&amp;b=%222%22" [^>]*><strong>club<\/strong><\/a>/);
  assert.match(email.body, /^Hi <img src=x onerror=alert\(1\)>, \{\{unknown\}\} club \(https:\/\/club\.test\/\?a=1&b=%222%22\)\n\n- One\n- Two$/);
  assert.equal(fillPlaceholders('{{a}}{{b}}', { a: 1 }), '1{{b}}');
});

test('the default template is valid and member values come from the record', () => {
  assert.ok(!(validateWelcomeDoc(DEFAULT_WELCOME_EMAIL.doc) instanceof Error));
  assert.equal(DEFAULT_WELCOME_EMAIL.enabled, false, 'nothing is sent until an admin switches it on');
  const values = welcomeValuesFor({ firstName: 'Ann', membershipTier: 'junior', validUntil: { toDate: () => new Date('2027-03-01T00:00:00Z') }, membershipNumber: 'FCC-1234' });
  assert.deepEqual(values, { firstName: 'Ann', lastName: '', membershipType: 'Junior membership', validUntil: '01/03/2027', membershipNumber: 'FCC-1234' });
  assert.equal(welcomeValuesFor({ justgoProfile: { membershipName: 'FCC Adult' } }).membershipType, 'FCC Adult');
});
