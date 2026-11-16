import test from 'node:test';
import assert from 'node:assert/strict';
import { createJustgoErasure, hasJustgoLink } from './justgoErasure.js';

const organisation = '11111111-1111-1111-1111-111111111111';
const memberId = '22222222-2222-2222-2222-222222222222';
const other = '33333333-3333-3333-3333-333333333333';
const settings = { JUSTGO_API_ENABLED: 'true', JUSTGO_API_WRITES_ENABLED: 'true',
  JUSTGO_API_SECRET: 'synthetic-secret', JUSTGO_ORGANISATION_ID: organisation };
const linked = [{ justgoMemberId: memberId }];
const fixture = ({ primary = true, keepLink = false } = {}) => {
  const calls = [];
  let organisations = [{ id: organisation, isPrimary: primary }, { id: other, isPrimary: !primary }];
  const fetchImpl = async (url, options) => {
    calls.push({ path: url.pathname, options });
    assert.equal(url.origin, 'https://api.justgo.com');
    assert.equal(options.redirect, 'error');
    if (url.pathname.endsWith('/Auth')) {
      assert.deepEqual(JSON.parse(options.body), { secret: 'synthetic-secret' });
      return Response.json({ data: { accessToken: 'synthetic-token', tokenType: 'Bearer', expiresIn: 3600 } });
    }
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    if (url.pathname.endsWith('/DeleteMember')) {
      assert.equal(options.method, 'DELETE');
      assert.deepEqual(JSON.parse(options.body), { organisationId: organisation, memberId, isAdditionalClub: !primary });
      if (!keepLink) organisations = organisations.filter((link) => link.id !== organisation);
      return Response.json({ statusCode: 200 });
    }
    assert.equal(url.pathname, `/api/v2.2/Members/${memberId}`);
    assert.equal(options.method, 'GET');
    return Response.json({ data: { id: memberId, organisations } });
  };
  return { calls, fetchImpl, removeExternally: () => { organisations = organisations.filter((link) => link.id !== organisation); } };
};

test('non-JustGo erasure never authenticates and JustGo writes are default-off even before Auth', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('No requests expected'); };
  assert.equal(hasJustgoLink({}), false);
  assert.equal(hasJustgoLink({ affiliationNumber: '12345' }), true);
  const empty = await createJustgoErasure({ env: {}, fetchImpl }).prepare([{}]);
  assert.deepEqual(await empty.unlink(), { unlinked: 0, alreadyUnlinked: 0 });
  for (const env of [{}, { ...settings, JUSTGO_API_WRITES_ENABLED: 'false' }, { ...settings, JUSTGO_API_SECRET: '' }]) {
    await assert.rejects(createJustgoErasure({ env, fetchImpl }).prepare(linked), /not configured or enabled/);
  }
  await assert.rejects(createJustgoErasure({ env: settings, fetchImpl }).prepare([{ affiliationNumber: '12345' }]), /confirmed organisation and member ID/);
  assert.equal(calls, 0);
});

for (const primary of [true, false]) {
  test(`only FCC is unlinked with confirmed ${primary ? 'primary' : 'additional'} club status`, async () => {
    const remote = fixture({ primary });
    const client = createJustgoErasure({ env: settings, fetchImpl: remote.fetchImpl });
    const plan = await client.prepare(linked);
    assert.equal(remote.calls.some(({ options }) => options.method === 'DELETE'), false, 'prepare cannot unlink');
    assert.deepEqual(await plan.unlink(), { unlinked: 1, alreadyUnlinked: 0 });
    assert.equal(remote.calls.filter(({ options }) => options.method === 'DELETE').length, 1);
    const retry = await client.prepare(linked);
    assert.deepEqual(await retry.unlink(), { unlinked: 0, alreadyUnlinked: 1 });
    assert.equal(remote.calls.filter(({ options }) => options.method === 'DELETE').length, 1, 'retry does not repeat deletion');
    assert.ok(remote.calls.every(({ path }) => !path.includes(other)), 'other club is never targeted');
  });
}

test('current club state is checked again after preparation, preventing stale duplicate removals', async () => {
  const remote = fixture();
  const plan = await createJustgoErasure({ env: settings, fetchImpl: remote.fetchImpl }).prepare(linked);
  remote.removeExternally();
  assert.deepEqual(await plan.unlink(), { unlinked: 0, alreadyUnlinked: 1 });
  assert.equal(remote.calls.some(({ options }) => options.method === 'DELETE'), false);
});

test('the documented null club list means no clubs, but a missing field cannot prove unlinking', async () => {
  const remote = fixture();
  const fetchImpl = (url, options) => url.pathname.endsWith('/Auth')
    ? remote.fetchImpl(url, options) : Response.json({ data: { id: memberId, organisations: null } });
  const plan = await createJustgoErasure({ env: settings, fetchImpl }).prepare(linked);
  assert.deepEqual(await plan.unlink(), { unlinked: 0, alreadyUnlinked: 1 });
  assert.equal(remote.calls.some(({ options }) => options.method === 'DELETE'), false);
});

test('HTTP success does not count as unlinking while the FCC link remains', async () => {
  const remote = fixture({ keepLink: true });
  const plan = await createJustgoErasure({ env: settings, fetchImpl: remote.fetchImpl }).prepare(linked);
  await assert.rejects(plan.unlink(), /still lists the FCC link/);
});

test('invalid identity, club status, Auth and remote failures cannot be mistaken for confirmed removal', async () => {
  for (const result of [
    { id: other, organisations: [] },
    { id: memberId },
    { id: memberId, organisations: [null] },
    { id: memberId, organisations: [{ id: 'invalid' }] },
    { id: memberId, organisations: [{ id: organisation, isPrimary: null }] },
    { id: memberId, organisations: [{ id: organisation, isPrimary: true }, { id: organisation, isPrimary: true }] }
  ]) {
    const remote = fixture();
    const fetchImpl = (url, options) => url.pathname.endsWith('/Auth') ? remote.fetchImpl(url, options) : Response.json({ data: result });
    await assert.rejects(createJustgoErasure({ env: settings, fetchImpl }).prepare(linked), /JustGo/);
  }
  for (const fetchImpl of [
    async () => Response.json({ data: { accessToken: 'token', tokenType: 'Bearer', expiresIn: -1 } }),
    async () => Response.json({ statusCode: 500 }),
    async () => new Response('PRIVATE ERROR BODY', { status: 403 }),
    async () => new Response('PRIVATE ERROR BODY'),
    async () => { throw new Error('PRIVATE ERROR BODY'); }
  ]) {
    await assert.rejects(createJustgoErasure({ env: settings, fetchImpl }).prepare(linked),
      (error) => /JustGo/.test(error.message) && !error.message.includes('PRIVATE ERROR BODY'));
  }
});

test('every family member is validated before any club link is removed', async () => {
  const remote = fixture();
  const fetchImpl = (url, options) => url.pathname.endsWith(other)
    ? Response.json({ data: { id: other, organisations: [{ id: organisation, isPrimary: null }] } })
    : remote.fetchImpl(url, options);
  await assert.rejects(createJustgoErasure({ env: settings, fetchImpl })
    .prepare([...linked, { justgoMemberId: other }]), /primary or additional/);
  assert.equal(remote.calls.some(({ options }) => options.method === 'DELETE'), false);
});

test('a lost unlink response keeps erasure unfinished and retry reads the already-removed link', async () => {
  const remote = fixture();
  let lost = true;
  const fetchImpl = async (url, options) => {
    const result = await remote.fetchImpl(url, options);
    if (options.method === 'DELETE' && lost) { lost = false; throw new Error('connection lost'); }
    return result;
  };
  const client = createJustgoErasure({ env: settings, fetchImpl });
  const plan = await client.prepare([...linked, ...linked]);
  await assert.rejects(plan.unlink(), /could not be confirmed/);
  const retry = await client.prepare(linked);
  assert.deepEqual(await retry.unlink(), { unlinked: 0, alreadyUnlinked: 1 });
  assert.equal(remote.calls.filter(({ options }) => options.method === 'DELETE').length, 1);
});
