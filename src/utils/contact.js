export const COMMITTEE_EMAIL = 'committee@forthcanoeclub.co.uk';

export const CONTACT_CATEGORIES = [
  'Equipment Needed',
  'Event Participants',
  'Maintenance Tasks',
  'Other'
];

export const CONTACT_LIMITS = {
  name: 120,
  email: 254,
  message: 5000
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const text = (value) => typeof value === 'string' ? value.trim() : '';
const oneLineText = (value) => text(value).replace(/\s+/g, ' ');

export const validateContactEnquiry = (body) => {
  const submission = body && typeof body === 'object' ? body : {};
  const name = oneLineText(submission.name);
  const email = text(submission.email).toLowerCase();
  const category = text(submission.category);
  const message = text(submission.message);

  if (!name || name.length > CONTACT_LIMITS.name) return { error: 'Enter your name.' };
  if (email.length > CONTACT_LIMITS.email || !EMAIL_PATTERN.test(email)) return { error: 'Enter a valid email address.' };
  if (!CONTACT_CATEGORIES.includes(category)) return { error: 'Choose a category.' };
  if (!message) return { error: 'Enter a message.' };
  if (message.length > CONTACT_LIMITS.message) return { error: `Keep your message under ${CONTACT_LIMITS.message} characters.` };

  return { value: { name, email, category, message } };
};

export const contactEnquiryEmail = ({ name, email, category, message }) => ({
  subject: `New website enquiry: ${category}`,
  body: [
    'New contact-form enquiry',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Category: ${category}`,
    '',
    'Message:',
    message
  ].join('\n')
});
