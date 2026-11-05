import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Send } from 'lucide-react';
import FormComponent from './FormComponent';
import { apiUrl } from '../utils/api';
import { CONTACT_CATEGORIES, CONTACT_LIMITS } from '../utils/contact';

const EMPTY_CONTACT = { name: '', email: '', category: '', message: '' };
const JSON_CONTENT_TYPE = 'application/json';

const readApiResponse = async (response, fallback) => {
  if (!response.headers.get('content-type')?.includes(JSON_CONTENT_TYPE)) throw new Error(fallback);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || fallback);
  return result;
};

function ContactForm() {
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const updateContact = (field, value) => setContact((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      if (!navigator.onLine) throw new Error('You are offline. Reconnect before sending your message.');
      const response = await fetch(apiUrl('/api/contact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contact)
      });
      await readApiResponse(response, 'The form service is unavailable. Please try again later.');
      setContact(EMPTY_CONTACT);
      setStatus({ type: 'success', message: 'Thank you. Your message has been sent to the committee.' });
    } catch (submitError) {
      setStatus({ type: 'error', message: submitError instanceof Error ? submitError.message : 'Your message could not be sent. Please try again later.' });
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="FormContainer">
    <div className="SpaceB8">
      <h2 className="form_heading_bold">Contact the club</h2>
      <p className="FormDescription">Equipment requests, events, maintenance and other enquiries.</p>
    </div>
    <form onSubmit={submit} className="FormBody">
      <div className="FormFieldGrid">
        <div>
          <label className="FormLabel" htmlFor="contact-name">Your Name *</label>
          <input id="contact-name" type="text" required maxLength={CONTACT_LIMITS.name} value={contact.name}
            onChange={(event) => updateContact('name', event.target.value)} className="FormInput" placeholder="John Doe" />
        </div>
        <div>
          <label className="FormLabel" htmlFor="contact-email">Email Address *</label>
          <input id="contact-email" type="email" required maxLength={CONTACT_LIMITS.email} value={contact.email}
            onChange={(event) => updateContact('email', event.target.value)} className="FormInput" placeholder="john@example.com" />
        </div>
      </div>
      <div>
        <label className="FormLabel" htmlFor="contact-category">Category *</label>
        <select id="contact-category" required value={contact.category}
          onChange={(event) => updateContact('category', event.target.value)} className="FormInput">
          <option value="">Select...</option>
          {CONTACT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </div>
      <div>
        <label className="FormLabel" htmlFor="contact-message">Message *</label>
        <textarea id="contact-message" required rows={6} maxLength={CONTACT_LIMITS.message} value={contact.message}
          onChange={(event) => updateContact('message', event.target.value)} className="FormInput" placeholder="How can we help?" />
      </div>
      {status && <div className={`FormAlert ${status.type === 'success' ? 'AlertSuccess' : 'AlertError'}`}
        role={status.type === 'success' ? 'status' : 'alert'}>
        <div className="FormAlertInner">
          {status.type === 'success' ? <CheckCircle className="IconLg FormAlertIcon" /> : <AlertCircle className="IconLg FormAlertIcon" />}
          <div className="FormAlertBody"><p className="FormAlertMessage">{status.message}</p></div>
        </div>
      </div>}
      <button type="submit" disabled={submitting} className="FormSubmitButton">
        {submitting ? <><div className="FormSpinner" />Sending...</> : <><Send className="IconMd" />Submit</>}
      </button>
    </form>
  </div>;
}

export default function ContactForms() {
  const [forms, setForms] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl('/api/forms'), { signal: controller.signal })
      .then((response) => readApiResponse(response, 'Could not load additional contact forms.'))
      .then((result) => setForms(result.forms))
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError instanceof Error ? loadError.message : 'Could not load additional contact forms.');
      });
    return () => controller.abort();
  }, []);
  return <div className="SectionContent">
    <ContactForm />
    {error && <p role="alert" className="StatusTextError">{error}</p>}
    {forms.map((form) => <FormComponent key={form.id} title={form.name} description={form.description}
      questions={form.fields.map((field) => ({ label: typeof field === 'string' ? field : field.label }))}
      endpoint={`/api/forms/${form.id}`} />)}
  </div>;
}
