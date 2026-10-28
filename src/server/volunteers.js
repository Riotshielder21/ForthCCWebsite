import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Timestamp } from 'firebase-admin/firestore';
import { validateListSubmission, sheetCell, matchesVolunteer, VOLUNTEER_LIST } from '../utils/lists.js';
import { membershipActivity } from '../utils/membership.js';
import { checkSummary, checksManagedByJustgo } from '../utils/safeguarding.js';
import { rateLimit } from './rateLimit.js';
import { clubYearOf, clubYearDates } from '../utils/clubYear.js';
import { normaliseVolunteerLevels, validateVolunteerBenefits, volunteerBenefitText, volunteerLevelLabel, volunteerYear, needsVolunteerRenewal } from '../utils/volunteering.js';
import { needsRenewal } from '../utils/renewals.js';
import { allocateRecordIds, reserveRecordIds } from '../utils/recordIds.js';
import { validateVolunteerPage, volunteerPageFromLegacy } from '../utils/volunteerPage.js';
import { normaliseName } from '../utils/checkout.js';


/** Public forms, yearly volunteer membership entitlements and privately emailed boathouse access codes. */
export const registerVolunteerRoutes = (app, { requireAdmin, db, sheets, toMembershipRecord, stripeSubscriptionIsActive, sendEmail, loadCatalogue, settleKeyAccess, requestNow = () => new Date() }) => {
  const lists = () => db().collection('lists');
  const signupYear = (signup) => Number.isInteger(signup.clubYear) ? signup.clubYear : clubYearOf(signup.createdAt?.toDate() || new Date());
  const benefitsReference = () => db().collection('settings').doc('volunteerBenefits');
  const coordinatorReference = () => db().collection('settings').doc('volunteerCoordinator');
  const pageReference = () => db().collection('settings').doc('volunteerPage');
  const loadVolunteerBenefits = async () => normaliseVolunteerLevels((await benefitsReference().get()).data()?.tiers);
  const legacyVolunteerPage = async () => {
    try {
      return volunteerPageFromLegacy(JSON.parse(await readFile(new URL('../../public/content/pages/volunteering.json', import.meta.url), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return volunteerPageFromLegacy();
    }
  };
  const loadVolunteerPage = async () => {
    const saved = await pageReference().get();
    return saved.exists ? saved.data().content : legacyVolunteerPage();
  };
  // Every live volunteering save is snapshotted (page content and levels together) so any earlier state can be restored.
  const versionCounter = () => db().collection('settings').doc('volunteerVersions');
  const versions = () => db().collection('volunteerVersions');
  const versionReference = (version) => versions().doc(`v${String(version).padStart(6, '0')}`);
  const ensureBaselineVersion = async () => {
    if ((await versionCounter().get()).exists) return;
    const legacy = await legacyVolunteerPage();
    await db().runTransaction(async (transaction) => {
      const [counter, page, benefits] = await Promise.all([versionCounter(), pageReference(), benefitsReference()].map((reference) => transaction.get(reference)));
      if (counter.exists) return;
      transaction.create(versionReference(1), { version: 1, content: page.exists ? page.data().content : legacy,
        tiers: normaliseVolunteerLevels(benefits.data()?.tiers), change: 'initial', editor: 'Server (initial version)', createdAt: Timestamp.now() });
      transaction.set(versionCounter(), { latest: 1 });
    });
  };
  const recordVersion = async (admin, change, restoredFrom = null) => {
    const [content, tiers] = await Promise.all([loadVolunteerPage(), loadVolunteerBenefits()]);
    return db().runTransaction(async (transaction) => {
      const version = ((await transaction.get(versionCounter())).data()?.latest || 0) + 1;
      transaction.create(versionReference(version), { version, content, tiers, change, editor: admin.email || admin.uid,
        createdAt: Timestamp.now(), ...(restoredFrom ? { restoredFrom } : {}) });
      transaction.set(versionCounter(), { latest: version });
      return version;
    });
  };
  const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const sendInductionNotification = async (reference, signup) => {
    const coordinator = (await coordinatorReference().get()).data()?.email || '';
    if (!coordinator) {
      await reference.update({ inductionNotificationStatus: 'not-configured' });
      return 'not-configured';
    }
    try {
      const emailSent = await sendEmail({
        to: coordinator,
        subject: 'New Forth Canoe Club volunteer sign-up',
        body: `A new volunteer sign-up needs follow-up.\n\nName: ${signup.name}\nEmail: ${signup.email}\nHours: ${signup.tier ? volunteerLevelLabel(await loadVolunteerBenefits(), signup.tier) : 'Not selected'}\nClub year: ${signup.clubYear}/${signup.clubYear + 1}\nSign-up: ${reference.id}\n\nPlease contact them to arrange an induction.`,
        record: { kind: 'volunteer-induction', signupId: reference.id }
      });
      if (!emailSent) throw new Error('The induction notification email could not be sent.');
      await reference.update({ inductionNotificationStatus: 'sent', inductionNotifiedAt: Timestamp.now() });
      return 'sent';
    } catch (error) {
      console.error('Could not notify volunteer induction coordinator:', error.message);
      await reference.update({ inductionNotificationStatus: 'failed' });
      return 'failed';
    }
  };
  const volunteerRenewalContent = async (members, year, siteUrl) => {
    const lines = [];
    const html = [];
    const levels = await loadVolunteerBenefits();
    for (const member of members.filter((member) => needsVolunteerRenewal(member, year))) {
      const token = crypto.randomBytes(32).toString('hex');
      await db().collection('volunteerRenewals').doc(hash(token)).set({ memberId: member.id, year,
        expiresAt: Timestamp.fromDate(new Date(clubYearDates(year).start.getTime() + 31 * 86400000)) });
      const link = `${siteUrl}/volunteering?volunteerRenew=${token}`;
      const name = `${member.firstName || ''} ${member.lastName || ''}`.trim();
      lines.push(`${name}: you have not signed up to volunteer next club year. Keep your ${volunteerLevelLabel(levels, volunteerYear(member, year - 1).tier).replace(/ hours$/, ' hour')} commitment: ${link}\nChoose different hours: ${link}&change=1`);
      html.push(`<p>${escape(name)}: <a href="${escape(link)}">Keep my volunteer hours next year</a> or <a href="${escape(link)}&amp;change=1">Choose a different commitment</a>. Confirm on the form to renew your volunteering.</p>`);
    }
    return { body: lines.join('\n\n'), html: html.join('') };
  };
  const renewalInvite = async (token, now) => {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const document = await db().collection('volunteerRenewals').doc(hash(token)).get();
    const invite = document.data();
    if (!invite || invite.expiresAt.toMillis() <= now.getTime()) return null;
    const member = await db().collection('memberships').doc(invite.memberId).get();
    if (!member.exists || !member.data().volunteer?.inducted) return null;
    return { document, invite, member };
  };
  app.get('/api/volunteers/renew/:token', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const loaded = await renewalInvite(req.params.token, requestNow(req));
      if (!loaded) return res.status(404).json({ error: 'This volunteer renewal link is invalid or expired.' });
      const { invite, member } = loaded;
      const data = member.data();
      const household = data.householdId ? (await db().collection('households').doc(data.householdId).get()).data() : null;
      res.json({ name: `${data.firstName || ''} ${data.lastName || ''}`.trim(), email: household?.email || data.email || data.guardian?.email || '',
        year: invite.year, tier: volunteerYear(data, invite.year)?.tier || volunteerYear(data, invite.year - 1)?.tier || '' });
    } catch (error) {
      console.error('Could not open volunteer renewal:', error.message);
      res.status(500).json({ error: 'Could not open volunteer renewal.' });
    }
  });
  app.post('/api/volunteers/renew/:token', rateLimit(5, 60 * 1000), async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const loaded = await renewalInvite(req.params.token, requestNow(req));
      if (!loaded) return res.status(404).json({ error: 'This volunteer renewal link is invalid or expired.' });
      const tier = (await loadVolunteerBenefits()).find((candidate) => candidate.id === req.body?.tier);
      if (!tier) return res.status(400).json({ error: 'Choose your volunteer hours bracket.' });
      const { invite, member } = loaded;
      const benefits = [volunteerBenefitText(tier, await loadCatalogue())];
      const household = member.data().householdId ? (await db().collection('households').doc(member.data().householdId).get()).data() : null;
      const email = household?.email || member.data().email || member.data().guardian?.email || '';
      await db().runTransaction(async (transaction) => {
        const current = (await transaction.get(member.ref)).data();
        if (!current?.volunteer?.inducted) throw new Error('The volunteer membership no longer exists or is no longer inducted.');
        const signups = await transaction.get(lists().where('memberId', '==', member.id));
        const signup = signups.docs.find((document) => document.data().listType === VOLUNTEER_LIST && signupYear(document.data()) === invite.year);
        const reservation = await reserveRecordIds(db(), transaction, 'volunteers', signup ? 0 : 1);
        const signupId = signup?.id || reservation.ids[0];
        reservation.save();
        const years = current.volunteer.years || {};
        transaction.update(member.ref, { volunteer: { ...current.volunteer, years: { ...years,
          [invite.year]: { active: true, tier: tier.id, hours: tier.hours, benefits, freeProductIds: tier.freeProductIds, signupId } } } });
        transaction.set(lists().doc(signupId), { name: `${current.firstName || ''} ${current.lastName || ''}`.trim(),
          email, memberId: member.id, listType: VOLUNTEER_LIST, clubYear: invite.year, tier: tier.id,
          inducted: true, active: true,
          ...(!signup ? { items: [], notes: '', createdAt: Timestamp.now() } : {}) }, { merge: true });
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Could not confirm volunteer renewal:', error.message);
      res.status(500).json({ error: 'Could not confirm volunteer renewal.' });
    }
  });

  const sendVolunteerRenewals = async (now, round, siteUrl) => {
    const year = clubYearOf(now) + 1;
    const mark = `${year}:${round}`;
    const snapshot = await db().collection('memberships').where('volunteer.inducted', '==', true).get();
    const groups = new Map();
    for (const document of snapshot.docs) {
      const member = { ...document.data(), id: document.id };
      if (!needsVolunteerRenewal(member, year) || needsRenewal(member, now) || (member.volunteerRenewalSentFor || []).includes(mark)
        || member.status !== 'active' || (member.validUntil?.toMillis() || 0) <= now.getTime()) continue;
      const household = member.householdId ? (await db().collection('households').doc(member.householdId).get()).data() : null;
      const email = household?.email || member.email || member.guardian?.email;
      if (!email) continue;
      groups.set(email, [...(groups.get(email) || []), member]);
    }
    let emails = 0, failures = 0;
    for (const [email, candidates] of groups) {
      const members = await db().runTransaction(async (transaction) => {
        const documents = await transaction.getAll(...candidates.map((member) => db().collection('memberships').doc(member.id)));
        const eligible = documents.filter((document) => document.exists).map((document) => ({ ...document.data(), id: document.id }))
          .filter((member) => needsVolunteerRenewal(member, year) && !needsRenewal(member, now) && !(member.volunteerRenewalSentFor || []).includes(mark));
        for (const member of eligible) transaction.update(db().collection('memberships').doc(member.id),
          { volunteerRenewalSentFor: (member.volunteerRenewalSentFor || []).concat(mark) });
        return eligible;
      });
      if (!members.length) continue;
      try {
        const content = await volunteerRenewalContent(members, year, siteUrl);
        const sent = await sendEmail({ to: email, subject: `Volunteer again with Forth Canoe Club for ${year}/${year + 1}`,
          body: `Thank you for volunteering. This is a volunteering reminder, not a request to buy membership or extras.\n\n${content.body}`, html: content.html,
          record: { kind: 'volunteer-renewal', membershipIds: members.map((member) => member.id) } });
        if (!sent) throw new Error('Volunteer renewal email could not be sent.');
        emails += 1;
      } catch (error) {
        console.error('Could not send volunteer renewal:', error.message);
        await db().runTransaction(async (transaction) => {
          const documents = await transaction.getAll(...members.map((member) => db().collection('memberships').doc(member.id)));
          for (const document of documents.filter((document) => document.exists)) transaction.update(document.ref,
            { volunteerRenewalSentFor: (document.data().volunteerRenewalSentFor || []).filter((value) => value !== mark) });
        });
        failures += 1;
      }
    }
    return { emails, failures };
  };

  app.get('/api/forms', rateLimit(60, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Forms are not configured.' });
      const snapshot = await db().collection('forms').where('clubYear', '==', clubYearOf()).limit(50).get();
      res.json({ forms: snapshot.docs.map((document) => {
        const { name, description, fields } = document.data();
        return { id: document.id, name, description, fields };
      }) });
    } catch (error) {
      console.error('Could not load contact forms:', error.message);
      res.status(500).json({ error: 'Could not load contact forms.' });
    }
  });
  app.post('/api/forms/:id', rateLimit(5, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Forms are not configured.' });
      const { error, value } = validateListSubmission({ ...req.body, listType: 'Other' });
      if (error) return res.status(400).json({ error });
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(req.params.id)) return res.status(400).json({ error: 'Choose a form.' });
      const form = await db().collection('forms').doc(req.params.id).get();
      if (!form.exists || form.data().clubYear !== clubYearOf()) return res.status(404).json({ error: 'This form is no longer available.' });
      const fields = form.data().fields || [];
      if (value.items.length !== fields.length || fields.some((field, index) => {
        const prefix = `${typeof field === 'string' ? field : field.label}: `;
        return !value.items[index].startsWith(prefix) || !value.items[index].slice(prefix.length).trim();
      })) return res.status(400).json({ error: 'Answer each question on the current form.' });
      const [submissionId] = await allocateRecordIds(db(), 'formSubmissions');
      await db().collection('formSubmissions').doc(submissionId).create({ ...value, formId: form.id, createdAt: Timestamp.now() });
      if (sheets() && form.data().spreadsheetId) {
        await sheets().spreadsheets.values.append({ spreadsheetId: form.data().spreadsheetId, range: 'A:Z',
          valueInputOption: 'RAW', requestBody: { values: [[new Date().toISOString(), value.email, ...value.items].map(sheetCell)] } });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Could not save contact form:', error.message);
      res.status(500).json({ error: 'Could not complete the form submission. Contact the club before submitting again.' });
    }
  });

  app.get('/api/volunteering', rateLimit(60, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Volunteering is not configured.' });
      const [content, tiers] = await Promise.all([loadVolunteerPage(), loadVolunteerBenefits()]);
      res.set('Cache-Control', 'no-store').json({ content, tiers });
    } catch (error) {
      console.error('Could not load volunteering:', error.message);
      res.status(500).json({ error: 'Could not load volunteering.' });
    }
  });
  app.post('/api/admin/volunteering', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { error, value } = validateVolunteerPage(req.body);
      if (error) return res.status(400).json({ error });
      await ensureBaselineVersion();
      await pageReference().set({ content: value, updatedBy: admin.uid, updatedAt: Timestamp.now() });
      res.json({ content: value, version: await recordVersion(admin, 'content') });
    } catch (error) {
      console.error('Could not save volunteering:', error.message);
      res.status(500).json({ error: 'Could not save volunteering.' });
    }
  });

  app.get('/api/volunteer-benefits', rateLimit(60, 60 * 1000), async (req, res) => {
    try {
      if (!db()) return res.status(503).json({ error: 'Volunteer benefits are not configured.' });
      res.json({ tiers: await loadVolunteerBenefits() });
    } catch (error) {
      console.error('Could not load volunteer benefits:', error.message);
      res.status(500).json({ error: 'Could not load volunteer benefits.' });
    }
  });
  app.post('/api/admin/volunteer-benefits', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { error, value } = validateVolunteerBenefits(req.body);
      if (error) return res.status(400).json({ error });
      await ensureBaselineVersion();
      const result = await applyLevels(value, admin, req);
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.json({ tiers: value, version: await recordVersion(admin, 'levels') });
    } catch (error) {
      console.error('Could not save volunteer benefits:', error.message);
      res.status(500).json({ error: 'Could not save volunteer benefits.' });
    }
  });
  const applyLevels = async (value, admin, req) => {
    const removed = (await loadVolunteerBenefits()).filter((level) => !value.some((kept) => kept.id === level.id));
    if (removed.length) {
      const inUse = await lists().where('tier', 'in', removed.map((level) => level.id)).get();
      const thisYear = clubYearOf(requestNow(req));
      const held = removed.filter((level) => inUse.docs.some((document) => document.data().listType === VOLUNTEER_LIST
        && document.data().tier === level.id && signupYear(document.data()) >= thisYear));
      if (held.length) {
        return { status: 409, error: `${held.map((level) => `${level.hours}+ hours (${level.title})`).join(', ')} still has volunteers this or next club year. Move them to another level in Reports & records → Volunteers before deleting it.` };
      }
    }
    const catalog = await loadCatalogue();
    if (value.some((tier) => tier.freeProductIds.some((id) => !catalog.some((product) => product.id === id && product.category === 'SERVICES')))) {
      return { status: 400, error: 'Free benefits must be existing shop services, not memberships or event tickets.' };
    }
    await benefitsReference().set({ tiers: value, updatedBy: admin.uid, updatedAt: Timestamp.now() });
    const members = await db().collection('memberships').where('volunteer.inducted', '==', true).get();
    for (let index = 0; index < members.docs.length; index += 200) {
      const batch = db().batch();
      for (const document of members.docs.slice(index, index + 200)) {
        const years = document.data().volunteer?.years || {};
        const updates = {};
        for (const [year, held] of Object.entries(years)) {
          const tier = value.find((candidate) => candidate.id === held.tier);
          if (tier) {
            updates[`volunteer.years.${year}.hours`] = tier.hours;
            updates[`volunteer.years.${year}.benefits`] = [volunteerBenefitText(tier, catalog)];
            updates[`volunteer.years.${year}.freeProductIds`] = tier.freeProductIds;
          }
        }
        if (Object.keys(updates).length) batch.update(document.ref, updates);
      }
      await batch.commit();
    }
    return {};
  };

  app.get('/api/admin/volunteering/versions', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      await ensureBaselineVersion();
      const snapshot = await versions().orderBy('version', 'desc').limit(100).get();
      res.set('Cache-Control', 'no-store').json({ versions: snapshot.docs.map((document) => {
        const { version, change, editor, createdAt, restoredFrom = null } = document.data();
        return { version, change, editor, createdAt: createdAt.toDate().toISOString(), restoredFrom };
      }) });
    } catch (error) {
      console.error('Could not list volunteering versions:', error.message);
      res.status(500).json({ error: 'Could not load the version history.' });
    }
  });
  app.post('/api/admin/volunteering/versions/:version/restore', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const number = Number(req.params.version);
      if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: 'Choose a version to restore.' });
      await ensureBaselineVersion();
      const saved = await versionReference(number).get();
      if (!saved.exists) return res.status(404).json({ error: `Version ${number} does not exist.` });
      // Old snapshots are re-validated so a restore can never bypass the current rules.
      const content = validateVolunteerPage(saved.data().content);
      const levels = validateVolunteerBenefits({ tiers: saved.data().tiers });
      if (content.error || levels.error) return res.status(400).json({ error: `Version ${number} cannot be restored: ${content.error || levels.error}` });
      const applied = await applyLevels(levels.value, admin, req);
      if (applied.error) return res.status(applied.status).json({ error: `Version ${number} cannot be restored: ${applied.error}` });
      await pageReference().set({ content: content.value, updatedBy: admin.uid, updatedAt: Timestamp.now() });
      const version = await recordVersion(admin, 'restore', number);
      res.json({ content: content.value, tiers: levels.value, version });
    } catch (error) {
      console.error('Could not restore volunteering version:', error.message);
      res.status(500).json({ error: 'Could not restore that version.' });
    }
  });

  app.get('/api/admin/volunteer-coordinator', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Volunteer storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      res.json({ email: (await coordinatorReference().get()).data()?.email || '' });
    } catch (error) {
      console.error('Could not load volunteer coordinator:', error.message);
      res.status(500).json({ error: 'Could not load volunteer coordinator.' });
    }
  });
  app.put('/api/admin/volunteer-coordinator', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Volunteer storage is not configured.' });
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (email && (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))) {
        return res.status(400).json({ error: 'Enter a valid coordinator email address, or leave it blank to turn off notifications.' });
      }
      await coordinatorReference().set({ email, updatedBy: admin.uid, updatedAt: Timestamp.now() });
      res.json({ email });
    } catch (error) {
      console.error('Could not save volunteer coordinator:', error.message);
      res.status(500).json({ error: 'Could not save volunteer coordinator.' });
    }
  });
  app.post('/api/admin/volunteers/:id/notify-induction', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Volunteer storage is not configured.' });
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.id)) return res.status(400).json({ error: 'Choose a volunteer sign-up.' });
      const reference = lists().doc(req.params.id);
      const document = await reference.get();
      if (!document.exists || document.data().listType !== VOLUNTEER_LIST) return res.status(404).json({ error: 'Volunteer sign-up not found.' });
      const status = await sendInductionNotification(reference, document.data());
      res.json({ success: status === 'sent', status });
    } catch (error) {
      console.error('Could not resend induction notification:', error.message);
      res.status(500).json({ error: 'Could not resend the induction notification.' });
    }
  });

  const findVolunteerMember = async ({ name, email }) => {
    const adminDb = db();
    const [byEmail, households] = await Promise.all([
      adminDb.collection('memberships').where('email', '==', email).limit(20).get(),
      adminDb.collection('households').where('email', '==', email).limit(20).get()
    ]);
    const householdMembers = (await Promise.all(households.docs.map((household) =>
      adminDb.collection('memberships').where('householdId', '==', household.id).limit(50).get()))).flatMap((snapshot) => snapshot.docs);
    const householdEmails = new Map(households.docs.map((household) => [household.id, household.data().email]));
    const candidates = [...new Map([...byEmail.docs, ...householdMembers].map((document) => [document.id, document])).values()];
    return candidates.find((document) => {
      const data = document.data();
      return matchesVolunteer({ ...data, contactEmails: [data.email, householdEmails.get(data.householdId)].filter(Boolean) }, { name, email });
    }) || null;
  };

  const memberIsActive = async (memberDocument) => {
    if (!memberDocument?.exists) return false;
    const member = toMembershipRecord(memberDocument);
    if (membershipActivity(member) !== 'active') return false;
    try {
      return await stripeSubscriptionIsActive(member);
    } catch (error) {
      console.error('Volunteer membership check failed:', error.message);
      return false;
    }
  };

  /** The sign-up's membership, linking one by name and contact email if it was not known yet. */
  const linkVolunteerMember = async (signupReference, signup) => {
    const memberDocument = signup.memberId ? await db().collection('memberships').doc(signup.memberId).get() : null;
    if (memberDocument?.exists) return memberDocument;
    const found = await findVolunteerMember(signup);
    if (found) await signupReference.update({ memberId: found.id });
    return found;
  };

  const boathouseCode = async () => (await db().collection('settings').doc('boathouseCode').get()).data() || {};

  /** Sign-ups share the member's key-access delivery record, preventing duplicate emails. */
  const settleBoathouseCode = async (signupReference, current = null) => {
    const signup = (await signupReference.get()).data();
    if (!signup || signup.listType !== VOLUNTEER_LIST) return 'not-volunteer';
    const member = await linkVolunteerMember(signupReference, signup);
    if (!member?.exists) return 'not-active';
    const outcome = await settleKeyAccess(member.ref, current);
    if (outcome === 'sent' || outcome === 'up-to-date') {
      const memberData = (await member.ref.get()).data();
      await signupReference.update({ boathouseCodeVersion: memberData.keyAccess.sentVersion });
    }
    return outcome;
  };

  /** Writes induction and yearly benefits onto the member, independently of anything they have already bought. */
  const recordVolunteerMembership = async (signupReference, signup, memberDocument, tier, benefits) => {
    const year = signupYear(signup);
    await db().runTransaction(async (transaction) => {
      const current = (await transaction.get(memberDocument.ref)).data();
      if (!current) throw new Error('The volunteer membership no longer exists.');
      const volunteer = current.volunteer || {};
      const next = { ...volunteer, signupId: signupReference.id,
        inducted: volunteer.inducted === true || signup.inducted === true,
        years: { ...volunteer.years, [year]: { tier: signup.tier || '', ...(tier ? { hours: tier.hours } : {}), active: signup.active === true && signup.inducted === true,
          benefits, freeProductIds: tier?.freeProductIds || [], signupId: signupReference.id } } };
      if (JSON.stringify(next) !== JSON.stringify(volunteer) || (next.inducted && !current.keyAccess?.grantedAt)) {
        transaction.update(memberDocument.ref, { volunteer: next,
          ...(next.inducted && !current.keyAccess?.grantedAt ? { 'keyAccess.grantedAt': Timestamp.now(), 'keyAccess.source': 'volunteer-induction' } : {}) });
      }
    });
  };

  const settleVolunteer = async (signupReference) => {
    let signup = (await signupReference.get()).data();
    if (!signup || signup.listType !== VOLUNTEER_LIST) return 'not-volunteer';
    const memberDocument = await linkVolunteerMember(signupReference, signup);
    if (memberDocument) signup = { ...signup, memberId: memberDocument.id };
    if (memberDocument?.exists) {
      const tier = (await loadVolunteerBenefits()).find((candidate) => candidate.id === signup.tier);
      const year = signupYear(signup);
      if (!Number.isInteger(signup.clubYear)) await signupReference.update({ clubYear: year });
      const benefits = tier ? [volunteerBenefitText(tier, await loadCatalogue())] : [];
      await recordVolunteerMembership(signupReference, signup, memberDocument, tier, benefits);
      if (!signup.inducted) return 'awaiting-induction';
      if (!tier) return 'needs-bracket';
      if (!signup.active) return 'inactive';
      if (!await memberIsActive(memberDocument)) return 'awaiting-membership';
      if (signup.benefitsEmailedFor === `${year}:${tier.id}`) return 'up-to-date';
      const sent = await sendEmail({ to: signup.email, subject: 'Your Forth Canoe Club volunteer benefits',
        body: `Hi ${signup.name},\n\nThank you for volunteering ${tier.hours}+ hours for club year ${year}/${year + 1}.\n${benefits.join('\n')}\n\nYour benefits are recorded on your membership and apply automatically at checkout when you use your membership details. Existing purchases and payments are unchanged. Contact the club if you want staff to arrange stopping payments for a benefit you already pay for.`,
        record: { kind: 'volunteer-benefits', signupId: signupReference.id, membershipIds: [memberDocument.id] } });
      if (!sent) throw new Error('Volunteer benefits saved, but the email could not be sent. Try activation again.');
      await signupReference.update({ benefitsEmailedFor: `${year}:${tier.id}` });
      return 'benefits-added';
    }
    return 'awaiting-membership';
  };

  app.post('/api/lists', rateLimit(5, 60 * 1000), async (req, res) => {
    const { error, value } = validateListSubmission(req.body);
    if (error) return res.status(400).json({ error });
    if (!db()) return res.status(503).json({ error: 'Submissions are not available right now.' });
    try {
      const volunteer = value.listType === VOLUNTEER_LIST;
      if (volunteer && value.tier && !(await loadVolunteerBenefits()).some((level) => level.id === value.tier)) {
        return res.status(400).json({ error: 'Choose a volunteer level.' });
      }
      if (volunteer) {
        const previous = await lists().where('email', '==', value.email).get();
        if (previous.docs.some((document) => document.data().listType === VOLUNTEER_LIST
          && normaliseName(document.data().name) === normaliseName(value.name)
          && signupYear(document.data()) === clubYearOf(requestNow(req)))) {
          return res.status(409).json({ error: 'A volunteer sign-up already exists for these details this club year. If you have signed up before, contact the club to check or change your hours and notes.' });
        }
      }
      const member = volunteer ? await findVolunteerMember(value) : null;
      const [signupId] = await allocateRecordIds(db(), volunteer ? 'volunteers' : 'lists');
      const reference = lists().doc(signupId);
      await reference.create({
        ...value, status: 'pending', createdAt: Timestamp.now(),
        ...(volunteer ? { memberId: member?.id || null, inducted: member?.data().volunteer?.inducted === true,
          clubYear: clubYearOf(requestNow(req)), active: false, discountCode: null,
          inductionNotificationStatus: 'pending' } : {})
      });
      if (member) await member.ref.set({ volunteer: { signupId: reference.id,
        inducted: member.data().volunteer?.inducted === true } }, { merge: true });
      if (volunteer) await sendInductionNotification(reference, { ...value, clubYear: clubYearOf(requestNow(req)) });

      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      if (sheets() && spreadsheetId) {
        try {
          await sheets().spreadsheets.values.append({
            spreadsheetId, range: 'Lists!A:G', valueInputOption: 'RAW',
            requestBody: { values: [[new Date().toISOString(), value.name, value.email, value.listType, value.items.join('; '), value.notes, reference.id].map(sheetCell)] }
          });
        } catch (sheetError) {
          console.error('List saved but not copied to Sheets:', sheetError.message);
        }
      }
      // The same answer whether or not a membership matched, so the form cannot be used to look people up.
      res.json({ success: true });
    } catch (submitError) {
      console.error('Could not save list submission:', submitError.message);
      res.status(500).json({ error: 'Could not submit the form. Please try again.' });
    }
  });

  app.get('/api/admin/volunteers', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      if (!await requireAdmin(req, res)) return;
      if (!db()) return res.status(503).json({ error: 'Volunteer storage is not configured.' });
      res.set('Cache-Control', 'no-store');
      let snapshot = await lists().where('listType', '==', VOLUNTEER_LIST).limit(500).get();
      // Reconcile older inducted sign-ups without emailing or assuming an hours bracket.
      const inducted = snapshot.docs.filter((document) => document.data().inducted === true);
      if (inducted.length) {
        const [tiers, catalog] = await Promise.all([loadVolunteerBenefits(), loadCatalogue()]);
        for (const document of inducted) {
          const signup = document.data();
          const member = await linkVolunteerMember(document.ref, signup);
          if (!member?.exists) continue;
          const tier = tiers.find((candidate) => candidate.id === signup.tier);
          await recordVolunteerMembership(document.ref, signup, member, tier, tier ? [volunteerBenefitText(tier, catalog)] : []);
        }
      }
      if (inducted.length) snapshot = await lists().where('listType', '==', VOLUNTEER_LIST).limit(500).get();
      const codeVersion = (await boathouseCode()).version || 0;
      const memberIds = [...new Set(snapshot.docs.map((document) => document.data().memberId).filter(Boolean))];
      const members = memberIds.length
        ? new Map((await db().getAll(...memberIds.map((id) => db().collection('memberships').doc(id)))).filter((document) => document.exists)
          .map((document) => [document.id, { ...toMembershipRecord(document), keyAccess: document.data().keyAccess, justgoSyncStatus: document.data().justgoSyncStatus,
            checks: checkSummary(document.data().checks), volunteer: document.data().volunteer }]))
        : new Map();
      const volunteers = snapshot.docs.map((document) => {
        const data = document.data();
        const member = members.get(data.memberId);
        return {
          id: document.id, name: data.name, email: data.email, items: data.items || [], notes: data.notes || '',
          memberId: member ? data.memberId : '', memberStatus: member ? membershipActivity(member) : 'not a member',
          inducted: data.inducted === true, codeIssued: Boolean(data.discountCode), codeEmailed: data.codeEmailed === true,
          active: data.active === true, boathouseCodeCurrent: Boolean(codeVersion) && member?.keyAccess?.sentVersion === codeVersion && !member.keyAccess.revokedAt,
          inductionNotificationStatus: data.inductionNotificationStatus || '',
          tier: data.tier || '', clubYear: signupYear(data),
          benefitsEmailPending: data.active === true && Boolean(data.tier) && data.benefitsEmailedFor !== `${signupYear(data)}:${data.tier}`,
          boathouseEmailPending: data.inducted === true && !member?.keyAccess?.revokedAt && Boolean(codeVersion) && member?.keyAccess?.sentVersion !== codeVersion,
          checksSynced: checksManagedByJustgo(member),
          checks: member?.checks || null,
          createdAt: data.createdAt?.toMillis() || 0
        };
      }).sort((a, b) => b.createdAt - a.createdAt);
      res.json({ volunteers, boathouseCodeSet: Boolean(codeVersion) });
    } catch (error) {
      console.error('Could not list volunteers:', error.message);
      res.status(500).json({ error: 'Could not load volunteers.' });
    }
  });

  app.patch('/api/admin/volunteers/:id', rateLimit(30, 60 * 1000), async (req, res) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!db()) return res.status(503).json({ error: 'Volunteer storage is not configured.' });
      const { inducted, active, tier } = req.body;
      if (inducted === false) return res.status(400).json({ error: 'Induction history is retained. Deactivate the volunteer instead.' });
      const changes = Object.keys(req.body);
      if (!changes.length || changes.some((key) => !['inducted', 'active', 'tier'].includes(key))
        || (inducted !== undefined && typeof inducted !== 'boolean') || (active !== undefined && typeof active !== 'boolean')
        || (tier !== undefined && typeof tier !== 'string') || !/^[A-Za-z0-9_-]{1,128}$/.test(req.params.id)) {
        return res.status(400).json({ error: 'Choose whether the volunteer is inducted or active.' });
      }
      const reference = lists().doc(req.params.id);
      const document = await reference.get();
      if (!document.exists || document.data().listType !== VOLUNTEER_LIST) return res.status(404).json({ error: 'Volunteer not found.' });
      const levels = await loadVolunteerBenefits();
      if (tier !== undefined && !levels.some((level) => level.id === tier)) return res.status(400).json({ error: 'Choose a current volunteer level.' });
      if (active === true && !levels.some((level) => level.id === (tier || document.data().tier))) return res.status(400).json({ error: 'Choose the volunteer level before activation.' });
      await reference.update({ ...(tier ? { tier } : {}), ...(typeof active === 'boolean' ? { active } : {}),
        ...((active === true || inducted === true) ? { inducted: true, inductedBy: admin.uid, inductedAt: document.data().inductedAt || Timestamp.now() } : {}),
        activeChangedBy: admin.uid, activeChangedAt: Timestamp.now() });
      const outcome = await settleVolunteer(reference);
      // Checking a volunteer in also gives an active volunteer the boathouse access codes.
      res.json({ success: true, outcome, boathouseCode: active === true || inducted === true ? await settleBoathouseCode(reference) : 'not-active' });
    } catch (error) {
      console.error('Could not update volunteer:', error.message);
      res.status(500).json({ error: 'Could not update the volunteer.' });
    }
  });

  /** After a paid order, link newly joined members and email their volunteer benefits and access codes. */
  const settleVolunteersFor = async (emails) => {
    if (!db()) return;
    for (const email of [...new Set(emails.filter(Boolean))].slice(0, 20)) {
      const snapshot = await lists().where('email', '==', email).limit(20).get();
      for (const document of snapshot.docs) {
        const data = document.data();
        if (data.listType !== VOLUNTEER_LIST || data.inducted !== true) continue;
        await settleVolunteer(document.ref);
        if (data.active === true) await settleBoathouseCode(document.ref);
      }
    }
  };

  return { settleVolunteersFor, loadVolunteerBenefits, volunteerRenewalContent, sendVolunteerRenewals };
};
