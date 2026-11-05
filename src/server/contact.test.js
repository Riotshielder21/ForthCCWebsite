import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { CONTACT_CATEGORIES, COMMITTEE_EMAIL } from '../utils/contact.js';
import { registerContactRoutes } from './contact.js';

const startContactServer = async (sendEmail) => {
  const app = express();
  app.use(express.json());
  registerContactRoutes(app, { sendEmail });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    endpoint: `http://127.0.0.1:${server.address().port}/api/contact`
  };
};

const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

test('contact endpoint emails the committee and sets the visitor as reply-to', async () => {
  const sent = [];
  const { server, endpoint } = await startContactServer(async (message) => {
    sent.push(message);
    return true;
  });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Paddler',
        email: 'alex@example.test',
        category: CONTACT_CATEGORIES[1],
        message: 'Could you tell me about the next open night?'
      })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(sent, [{
      to: COMMITTEE_EMAIL,
      subject: 'New website enquiry: Event Participants',
      body: [
        'New contact-form enquiry',
        '',
        'Name: Alex Paddler',
        'Email: alex@example.test',
        'Category: Event Participants',
        '',
        'Message:',
        'Could you tell me about the next open night?'
      ].join('\n'),
      replyTo: 'alex@example.test',
      record: { kind: 'contact-enquiry' }
    }]);
  } finally {
    await close(server);
  }
});

test('contact endpoint rejects invalid submissions without attempting delivery', async () => {
  const sent = [];
  const { server, endpoint } = await startContactServer(async (message) => {
    sent.push(message);
    return true;
  });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alex', email: 'not-an-email', category: CONTACT_CATEGORIES[0], message: 'Hello' })
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Enter a valid email address.' });
    assert.deepEqual(sent, []);
  } finally {
    await close(server);
  }
});

test('contact endpoint does not claim success when email delivery is unavailable', async () => {
  const { server, endpoint } = await startContactServer(async () => false);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Paddler',
        email: 'alex@example.test',
        category: CONTACT_CATEGORIES[0],
        message: 'Hello'
      })
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Your message could not be sent. Please try again later.' });
  } finally {
    await close(server);
  }
});
