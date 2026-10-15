import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  addFamilyMember, assignLine, blankPerson, isFamilyMembership, isMembership, needsPerson, personKind, familyRole, resolvedKind, FAMILY_ADULT_MAX,
  normaliseName, personDetailErrors, ageProblem, FAMILY_MAX, SWIMMING_LEVELS, DISCLAIMER_TEXT, PHOTO_CONSENT_TEXT
} from '../utils/checkout';
import { apiUrl } from '../utils/api';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CheckoutPage({ lines, people, onPeopleChange, email, onEmailChange, serverErrors, focusPersonId, busy, total, onBack, onReset, onPay, makeId }) {
  const addOnLines = lines.filter((line) => needsPerson(line) && !isMembership(line));
  const [stepKey, setStepKey] = useState('email');
  const [errors, setErrors] = useState([]);
  const [names, setNames] = useState([]);

  // Family members are filled in on their family membership's page, so they get no step of their own.
  const stepPeople = useMemo(() => people.filter((candidate) => familyRole(candidate, people, lines) !== 'member'), [people, lines]);
  const steps = useMemo(() => ['email', ...stepPeople.map((candidate) => `person:${candidate.id}`), ...(addOnLines.length ? ['assign'] : []), 'review'], [stepPeople, addOnLines.length]);
  const current = steps.includes(stepKey) ? stepKey : steps[0];
  const index = steps.indexOf(current);
  const person = current.startsWith('person:') ? people.find((candidate) => `person:${candidate.id}` === current) : null;

  useEffect(() => {
    if (!focusPersonId) return;
    const target = people.find((candidate) => candidate.id === focusPersonId);
    const familyLineId = target?.lineIds.find((id) => lines.find((line) => line.lineId === id && isFamilyMembership(line)));
    const owner = familyLineId && familyRole(target, people, lines) === 'member' ? people.find((candidate) => candidate.lineIds.includes(familyLineId)) : target;
    setStepKey(`person:${owner?.id || focusPersonId}`);
  }, [focusPersonId, serverErrors]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [current]);

  const personLabel = (candidate) => [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || `Person ${people.indexOf(candidate) + 1}`;
  const held = (candidate) => candidate.lineIds.map((id) => lines.find((line) => line.lineId === id)).filter(Boolean);
  const lineLabel = (line) => {
    const same = lines.filter((candidate) => candidate.id === line.id);
    return same.length > 1 ? `${line.name} (${same.indexOf(line) + 1} of ${same.length})` : line.name;
  };
  const update = (id, change) => onPeopleChange(people.map((candidate) => candidate.id === id ? change(candidate) : candidate));
  const field = (key) => (event) => update(person.id, (candidate) => ({ ...candidate, [key]: event.target.value }));
  const nested = (group, key) => (event) => update(person.id, (candidate) => ({ ...candidate, [group]: { ...candidate[group], [key]: event.target.value } }));
  const check = (key) => (event) => update(person.id, (candidate) => ({ ...candidate, [key]: event.target.checked }));

  const fetchNames = async () => {
    try {
      const response = await fetch(apiUrl('/api/membership-names'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const result = await response.json();
      setNames(Array.isArray(result.names) ? result.names : []);
    } catch {
      setNames([]);
    }
  };

  const go = async (direction) => {
    if (direction > 0) {
      let problems = [];
      if (current === 'email') {
        if (!EMAIL.test(email.trim())) problems = ['Enter a valid email address to receive your receipt.'];
        else if (people.length) await fetchNames();
      } else if (person) {
        problems = [
          ...personDetailErrors(person, personLabel(person), lines, new Date(), role),
          ...familyMembers.flatMap((member, seat) => personDetailErrors(member, `Family member ${seat + 2}`, lines, new Date(), 'member')),
          ...(familyAdults > FAMILY_ADULT_MAX ? [`A family can have at most ${FAMILY_ADULT_MAX} adults.`] : [])
        ];
      } else if (current === 'assign') {
        problems = [
          ...addOnLines.filter((line) => !people.some((candidate) => candidate.lineIds.includes(line.lineId))).map((line) => `${lineLabel(line)}: choose who it is for.`),
          ...people.filter((candidate) => !candidate.lineIds.length).map((candidate) => `${personLabel(candidate)} has no items. Choose their items or remove them.`)
        ];
      }
      setErrors(problems);
      if (problems.length) return;
      if (current === 'review') return onPay();
    } else {
      setErrors([]);
    }
    setStepKey(steps[Math.min(steps.length - 1, Math.max(0, index + direction))]);
  };

  const removePerson = (target) => {
    const remaining = people.filter((candidate) => candidate.id !== target.id);
    onPeopleChange(remaining);
    setStepKey(steps.includes('assign') ? 'assign' : index > 1 ? steps[index - 1] : 'email');
  };

  const addPerson = (lineIds = []) => {
    const id = makeId();
    onPeopleChange([...people, { ...blankPerson(id), lineIds, manual: true }]);
    setStepKey(`person:${id}`);
  };

  const familyLine = person && held(person).find(isFamilyMembership);
  const familyMembers = familyLine ? people.filter((candidate) => candidate.id !== person.id && candidate.lineIds.includes(familyLine.lineId)) : [];
  const familyCount = familyMembers.length + (familyLine ? 1 : 0);
  // Whoever holds a membership in the basket is required; remove the membership from the basket to drop them.
  const canRemove = person && !held(person).some(isMembership) && (!person.lineIds.length || people.length > 1);
  const removeMember = (id) => onPeopleChange(people.filter((candidate) => candidate.id !== id));
  const taken = new Set(people.filter((candidate) => candidate.returning && candidate.id !== person?.id).map((candidate) => normaliseName(`${candidate.firstName} ${candidate.lastName}`)));
  const choices = names.filter((name) => !taken.has(normaliseName(`${name.firstName} ${name.lastName}`)));
  const role = person ? familyRole(person, people, lines) : null;
  const minor = person ? resolvedKind(person, people, lines) === 'junior' : false;
  const fixedTier = person ? role === 'primary' || held(person).some((line) => ['junior', 'adult'].includes(line.membershipTier)) : true;
  const familyAdults = familyLine ? people.filter((candidate) => candidate.lineIds.includes(familyLine.lineId) && resolvedKind(candidate, people, lines) === 'adult').length : 0;
  const memberships = person ? held(person).filter(isMembership) : [];
  const membershipSteps = stepPeople.filter((candidate) => held(candidate).some(isMembership));
  const tierName = (line) => ({ adult: 'Adult', junior: 'Junior', family: 'Family' })[line?.membershipTier] || 'Membership';
  const heading = !person ? '' : memberships.length
    ? `Membership ${membershipSteps.indexOf(person) + 1} of ${membershipSteps.length} (${tierName(memberships[0])})`
    : 'Existing member';
  const memberField = (id, key) => (event) => update(id, (candidate) => ({ ...candidate, [key]: event.target.value }));
  const memberCheck = (id, key) => (event) => update(id, (candidate) => ({ ...candidate, [key]: event.target.checked }));
  const shownErrors = [...errors, ...(serverErrors || []).filter((message) => !errors.includes(message))];

  return (
    <div className="CheckoutPage PageFadeIn">
      <div className="CheckoutPageTop">
        <button type="button" className="PrimaryActionButtonCompact" onClick={onBack} disabled={busy}><ArrowLeft className="IconSm" /> Back to basket</button>
        <button type="button" className="CartRemoveButton" onClick={() => { setErrors([]); setStepKey('email'); onReset(); }} disabled={busy}>Clear my details</button>
        <span className="tile_eyebrow">Step {index + 1} of {steps.length}</span>
      </div>

      <div className="main_tile">
        {current === 'email' && (
          <div className="CheckoutDetails">
            <h2 className="page_heading_bold_1">Your contact email</h2>
            <p className="text_container">Your receipt and any voucher codes are sent here. If you already have a membership under this email, you can pick your name on the next page instead of typing everything again.</p>
            <label className="FormLabel">Email
              <input className="FormInput" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="you@example.com" />
            </label>
          </div>
        )}

        {person && (
          <div className="CheckoutDetails">
            <h2 className="page_heading_bold_1">{heading}</h2>
            {canRemove && <button type="button" className="PrimaryActionButtonCompact" onClick={() => removePerson(person)}>Cancel and remove this person</button>}
            <p className="CartItemMeta">{memberships.length ? memberships.map(lineLabel).join(', ') : 'Existing member. Add-ons are chosen on a later step.'}</p>

            {!person.returning && !person.firstName && choices.length > 0 && (
              <div className="CheckoutSection">
                <h4 className="CartItemTitle">Already a member? Choose your name</h4>
                <div className="CheckoutNames">
                  {choices.map((name) => (
                    <button key={`${name.firstName} ${name.lastName}`} type="button" className="PrimaryActionButtonCompact"
                      onClick={() => update(person.id, (candidate) => ({ ...candidate, returning: true, firstName: name.firstName, lastName: name.lastName }))}>
                      {name.firstName} {name.lastName}
                    </button>
                  ))}
                </div>
                <p className="CartItemMeta">Someone new? Just fill in the form below.</p>
              </div>
            )}

            {person.returning ? (
              <>
                <p className="text_container"><strong>{person.firstName} {person.lastName}</strong></p>
                <label className="FormLabel">Confirm date of birth
                  <input className="FormInput" type="date" required value={person.dob} onChange={field('dob')} />
                </label>
                <p className="CartItemMeta">We match this with your membership record. We never show other details.</p>
                <button type="button" className="PrimaryActionButtonCompact" onClick={() => update(person.id, (candidate) => ({ ...candidate, returning: false, firstName: '', lastName: '', dob: '' }))}>This is not me / enter full details</button>
              </>
            ) : (
              <>
                {!fixedTier && (
                  <fieldset className="CheckoutFieldset">
                    <legend>This person is</legend>
                    <label className="CheckoutCheck"><input type="radio" name={`kind-${person.id}`} checked={!person.junior} disabled={role === 'member' && person.junior === true && familyAdults >= FAMILY_ADULT_MAX} onChange={() => update(person.id, (candidate) => ({ ...candidate, junior: false }))} /> An adult (18 or over)</label>
                    <label className="CheckoutCheck"><input type="radio" name={`kind-${person.id}`} checked={person.junior === true} onChange={() => update(person.id, (candidate) => ({ ...candidate, junior: true }))} /> Under 18</label>
                  </fieldset>
                )}
                {role === 'primary' && <p className="CartItemMeta">The first person is the family contact and must be an adult (18 or over). Their phone, email, address and emergency contact below are shared by everyone on this family membership (up to {FAMILY_MAX} people, at most {FAMILY_ADULT_MAX} adults).</p>}
                <div className="CheckoutGrid">
                  <label className="FormLabel">First name<input className="FormInput" required maxLength={80} autoComplete="off" value={person.firstName} onChange={field('firstName')} /></label>
                  <label className="FormLabel">Last name<input className="FormInput" required maxLength={80} autoComplete="off" value={person.lastName} onChange={field('lastName')} /></label>
                  <label className="FormLabel">Date of birth<input className="FormInput" type="date" required aria-label="Date of birth" aria-invalid={Boolean(ageProblem(person, lines, role))} value={person.dob} onChange={field('dob')} />{ageProblem(person, lines, role) && <span className="StatusText StatusTextError">{ageProblem(person, lines, role)}</span>}</label>
                  {role !== 'member' && !minor && <label className="FormLabel">Phone<input className="FormInput" type="tel" required maxLength={40} value={person.phone} onChange={field('phone')} /></label>}
                  {role !== 'member' && !minor && <label className="FormLabel">Email<input className="FormInput" type="email" required maxLength={254} value={person.email} onChange={field('email')} /></label>}
                  {role !== 'member' && !minor && <label className="FormLabel">Address<input className="FormInput" required maxLength={300} value={person.address} onChange={field('address')} /></label>}
                  {role !== 'member' && !minor && <label className="FormLabel">Postcode<input className="FormInput" required maxLength={12} value={person.postcode} onChange={field('postcode')} /></label>}
                  {!role && <label className="FormLabel">Paddle Scotland / JustGo membership number (if you have one)<input className="FormInput" maxLength={40} value={person.scaNumber} onChange={field('scaNumber')} /></label>}
                  <label className="FormLabel">Swimming ability
                    <select className="FormInput" required value={person.swimming} onChange={field('swimming')}>
                      <option value="">Choose</option>
                      {SWIMMING_LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>
                <label className="FormLabel">Medical conditions or notes<textarea className="FormInput" rows="2" maxLength={1000} value={person.medical} onChange={field('medical')} /></label>
                {role === 'member' ? (
                  <p className="CartItemMeta">{minor ? 'Parents are their emergency contact.' : 'Shares the family contact details and family emergency contact.'}</p>
                ) : minor ? (
                  <fieldset className="CheckoutFieldset">
                    <legend>Parent / guardian (contact details and emergency contact)</legend>
                    <div className="CheckoutGrid">
                      <label className="FormLabel">Name<input className="FormInput" required maxLength={120} value={person.guardian.name} onChange={nested('guardian', 'name')} /></label>
                      <label className="FormLabel">Relationship<input className="FormInput" maxLength={60} value={person.guardian.relationship} onChange={nested('guardian', 'relationship')} /></label>
                      <label className="FormLabel">Phone<input className="FormInput" type="tel" required maxLength={40} value={person.guardian.phone} onChange={nested('guardian', 'phone')} /></label>
                      <label className="FormLabel">Email<input className="FormInput" type="email" required maxLength={254} value={person.guardian.email} onChange={nested('guardian', 'email')} /></label>
                      <label className="FormLabel">Address<input className="FormInput" required maxLength={300} value={person.guardian.address} onChange={nested('guardian', 'address')} /></label>
                      <label className="FormLabel">Postcode<input className="FormInput" required maxLength={12} value={person.guardian.postcode} onChange={nested('guardian', 'postcode')} /></label>
                    </div>
                  </fieldset>
                ) : (
                  <fieldset className="CheckoutFieldset">
                    <legend>{role === 'primary' ? 'Family emergency contact' : 'Emergency contact'}</legend>
                    <div className="CheckoutGrid">
                      <label className="FormLabel">Name<input className="FormInput" required maxLength={120} value={person.emergencyContact.name} onChange={nested('emergencyContact', 'name')} /></label>
                      <label className="FormLabel">Relationship<input className="FormInput" maxLength={60} value={person.emergencyContact.relationship} onChange={nested('emergencyContact', 'relationship')} /></label>
                      <label className="FormLabel">Phone<input className="FormInput" type="tel" required maxLength={40} value={person.emergencyContact.phone} onChange={nested('emergencyContact', 'phone')} /></label>
                    </div>
                  </fieldset>
                )}
                <label className="CheckoutCheck"><input type="checkbox" checked={person.photoConsent} onChange={check('photoConsent')} /> {PHOTO_CONSENT_TEXT}</label>
              </>
            )}
            <label className="CheckoutCheck"><input type="checkbox" checked={person.disclaimerAccepted} onChange={check('disclaimerAccepted')} /> {DISCLAIMER_TEXT}</label>

            {familyLine && (
              <>
                {familyMembers.map((member, seat) => (
                  <section key={member.id} className="CheckoutPerson">
                    <div className="CheckoutPersonHeader">
                      <h4 className="CartItemTitle">Family member {seat + 2}</h4>
                      {familyCount > 1 && <button type="button" className="CartRemoveButton" onClick={() => removeMember(member.id)}>Remove</button>}
                    </div>
                    <fieldset className="CheckoutFieldset">
                      <legend>This person is</legend>
                      <label className="CheckoutCheck"><input type="radio" name={`kind-${member.id}`} checked={!member.junior} disabled={member.junior === true && familyAdults >= FAMILY_ADULT_MAX} onChange={() => update(member.id, (candidate) => ({ ...candidate, junior: false }))} /> An adult (18 or over)</label>
                      <label className="CheckoutCheck"><input type="radio" name={`kind-${member.id}`} checked={member.junior === true} onChange={() => update(member.id, (candidate) => ({ ...candidate, junior: true }))} /> Under 18</label>
                    </fieldset>
                    <div className="CheckoutGrid">
                      <label className="FormLabel">First name<input className="FormInput" required maxLength={80} autoComplete="off" value={member.firstName} onChange={memberField(member.id, 'firstName')} /></label>
                      <label className="FormLabel">Last name<input className="FormInput" required maxLength={80} autoComplete="off" value={member.lastName} onChange={memberField(member.id, 'lastName')} /></label>
                      <label className="FormLabel">Date of birth<input className="FormInput" type="date" required aria-label="Date of birth" aria-invalid={Boolean(ageProblem(member, lines, 'member'))} value={member.dob} onChange={memberField(member.id, 'dob')} />{ageProblem(member, lines, 'member') && <span className="StatusText StatusTextError">{ageProblem(member, lines, 'member')}</span>}</label>
                      <label className="FormLabel">Swimming ability
                        <select className="FormInput" required value={member.swimming} onChange={memberField(member.id, 'swimming')}>
                          <option value="">Choose</option>
                          {SWIMMING_LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="FormLabel">Medical conditions or notes<textarea className="FormInput" rows="2" maxLength={1000} value={member.medical} onChange={memberField(member.id, 'medical')} /></label>
                    <p className="CartItemMeta">{member.junior ? 'Parents are their emergency contact.' : 'Shares the family contact details and family emergency contact.'}</p>
                    <label className="CheckoutCheck"><input type="checkbox" checked={member.photoConsent} onChange={memberCheck(member.id, 'photoConsent')} /> {PHOTO_CONSENT_TEXT}</label>
                    <label className="CheckoutCheck"><input type="checkbox" checked={member.disclaimerAccepted} onChange={memberCheck(member.id, 'disclaimerAccepted')} /> {DISCLAIMER_TEXT}</label>
                  </section>
                ))}
                <button type="button" className="PrimaryActionButtonCompact" disabled={familyCount >= FAMILY_MAX}
                  onClick={() => onPeopleChange(addFamilyMember(people, familyLine.lineId, makeId))}>
                  Add another family member ({familyCount}/{FAMILY_MAX})
                </button>
              </>
            )}
          </div>
        )}

        {current === 'assign' && (
          <div className="CheckoutDetails">
            <h2 className="page_heading_bold_1">Who are the add-ons for?</h2>
            <p className="text_container">Memberships are already assigned. Choose who each add-on is for.</p>
            {addOnLines.map((line) => (
              <label key={line.lineId} className="FormLabel">{lineLabel(line)}
                <select className="FormInput" value={people.find((candidate) => candidate.lineIds.includes(line.lineId))?.id || ''} onChange={(event) => onPeopleChange(assignLine(people, line.lineId, event.target.value))}>
                  <option value="">Choose…</option>
                  {people.map((candidate) => <option key={candidate.id} value={candidate.id}>{personLabel(candidate)}</option>)}
                </select>
              </label>
            ))}
            <button type="button" className="PrimaryActionButtonCompact" onClick={() => addPerson()}>Add another person (existing member)</button>
          </div>
        )}

        {current === 'review' && (
          <div className="CheckoutDetails">
            <h2 className="page_heading_bold_1">Review and pay</h2>
            <p className="text_container">Receipt email: <strong>{email}</strong></p>
            {people.map((candidate) => (
              <div key={candidate.id} className="CheckoutSection">
                <h4 className="CartItemTitle">{personLabel(candidate)}</h4>
                <p className="CartItemMeta">{held(candidate).map(lineLabel).join(', ')}</p>
              </div>
            ))}
            {lines.filter((line) => !needsPerson(line)).map((line) => <p key={line.lineId} className="text_container">{line.name}</p>)}
            <p className="CartSummaryTotal">Total £{total.toFixed(2)}</p>
          </div>
        )}

        {shownErrors.length > 0 && <ul className="StatusText StatusTextError CheckoutErrors">{shownErrors.map((message) => <li key={message}>{message}</li>)}</ul>}

        <div className="CheckoutNav">
          <button type="button" className="PrimaryActionButtonCompact" onClick={() => go(-1)} disabled={busy || index === 0}><ArrowLeft className="IconSm" /> Previous</button>
          <button type="button" className="CheckoutButton" onClick={() => go(1)} disabled={busy}>
            {current === 'review' ? (busy ? 'Starting payment…' : 'Continue to payment') : <>Next <ArrowRight className="IconSm" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
