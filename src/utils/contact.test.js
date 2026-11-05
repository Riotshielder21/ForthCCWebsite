import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_CATEGORIES, CONTACT_LIMITS, contactEnquiryEmail, validateContactEnquiry } from './contact.js';

test('contact enquiries are trimmed and normalised before sending', () => {
  const enquiry = validateContactEnquiry({
    name: '  Alex   Paddler  ',
    email: ' ALEX@EXAMPLE.TEST ',
    category: CONTACT_CATEGORIES[0],
    message: '  Please reserve a buoyancy aid.  '
  });

  assert.deepEqual(enquiry.value, {
    name: 'Alex Paddler',
    email: 'alex@example.test',
    category: 'Equipment Needed',
    message: 'Please reserve a buoyancy aid.'
  });
  assert.deepEqual(contactEnquiryEmail(enquiry.value), {
    subject: 'New website enquiry: Equipment Needed',
    body: [
      'New contact-form enquiry',
      '',
      'Name: Alex Paddler',
      'Email: alex@example.test',
      'Category: Equipment Needed',
      '',
      'Message:',
      'Please reserve a buoyancy aid.'
    ].join('\n')
  });
});

test('contact enquiries require valid, bounded input', () => {
  const valid = {
    name: 'Alex Paddler',
    email: 'alex@example.test',
    category: CONTACT_CATEGORIES[0],
    message: 'Hello'
  };

  assert.deepEqual(validateContactEnquiry({ ...valid, name: '' }), { error: 'Enter your name.' });
  assert.deepEqual(validateContactEnquiry({ ...valid, email: 'alex.example.test' }), { error: 'Enter a valid email address.' });
  assert.deepEqual(validateContactEnquiry({ ...valid, category: 'Not a category' }), { error: 'Choose a category.' });
  assert.deepEqual(validateContactEnquiry({ ...valid, message: '' }), { error: 'Enter a message.' });
  assert.deepEqual(validateContactEnquiry({ ...valid, message: 'x'.repeat(CONTACT_LIMITS.message + 1) }),
    { error: `Keep your message under ${CONTACT_LIMITS.message} characters.` });
});
