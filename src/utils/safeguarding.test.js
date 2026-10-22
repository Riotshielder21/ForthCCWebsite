import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStatus, checkLabel, checkSummary, validateCheckUpdate, formatCheckDate } from './safeguarding.js';

const now = new Date('2026-06-15T15:00:00Z');

test('a check is active, due to expire within 90 days, expired after its date, or not recorded', () => {
  assert.equal(checkStatus('', now), 'none');
  assert.equal(checkStatus(undefined, now), 'none');
  assert.equal(checkStatus('2026-02-30', now), 'none', 'impossible dates are ignored');
  assert.equal(checkStatus('2027-06-15', now), 'active');
  assert.equal(checkStatus('2026-09-14', now), 'active', '91 days left');
  assert.equal(checkStatus('2026-09-13', now), 'due', '90 days left');
  assert.equal(checkStatus('2026-06-15', now), 'due', 'still valid on the expiry date');
  assert.equal(checkStatus('2026-06-14', now), 'expired');
});

test('check labels and summaries read well in reports', () => {
  assert.equal(formatCheckDate('2026-12-31'), '31/12/2026');
  assert.equal(checkLabel('2026-07-01', now), 'Due to expire (01/07/2026)');
  assert.equal(checkLabel('2020-01-01', now), 'Expired (01/01/2020)');
  assert.equal(checkLabel('', now), 'Not recorded');
  assert.deepEqual(checkSummary({ pvg: { expiresOn: '2028-01-01' }, safeguarding: { expiresOn: 'soon' } }, now), {
    pvg: { expiresOn: '2028-01-01', status: 'active' },
    safeguarding: { expiresOn: '', status: 'none' }
  });
  assert.deepEqual(checkSummary(undefined, now).pvg, { expiresOn: '', status: 'none' });
});

test('admin check updates accept expiry dates or blanks for PVG and safeguarding only', () => {
  assert.deepEqual(validateCheckUpdate({ pvg: '2028-03-01' }), { value: { pvg: '2028-03-01' } });
  assert.deepEqual(validateCheckUpdate({ pvg: '', safeguarding: '2027-01-31' }), { value: { pvg: '', safeguarding: '2027-01-31' } });
  assert.ok(validateCheckUpdate({}).error);
  assert.ok(validateCheckUpdate(null).error);
  assert.ok(validateCheckUpdate({ dbs: '2028-01-01' }).error);
  assert.ok(validateCheckUpdate({ pvg: '01/03/2028' }).error);
  assert.ok(validateCheckUpdate({ pvg: '2028-02-30' }).error);
  assert.ok(validateCheckUpdate({ pvg: '1999-12-31' }).error);
  assert.ok(validateCheckUpdate({ safeguarding: 20280101 }).error);
});
