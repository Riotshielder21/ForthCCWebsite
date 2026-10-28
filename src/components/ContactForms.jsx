import React, { useEffect, useState } from 'react';
import FormComponent from './FormComponent';
import { apiUrl } from '../utils/api';

const QUESTIONS = {
  'Equipment Needed': [{ label: 'What equipment do you need?' }, { label: 'What date do you need it by?' }],
  'Event Participants': [{ label: 'Which event?' }, { label: 'How many people are attending?' }],
  'Maintenance Tasks': [{ label: 'What needs doing?', multiline: true }, { label: 'Where is it?' }],
  Other: [{ label: 'How can we help?', multiline: true }]
};

export default function ContactForms() {
  const [forms, setForms] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(apiUrl('/api/forms')).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load contact forms.');
      setForms(result.forms);
    }).catch((error) => setError(error.message));
  }, []);
  return <div className="SectionContent">
    <FormComponent title="Contact the club" description="Equipment requests, events, maintenance and other enquiries."
      categories={Object.keys(QUESTIONS)} questions={QUESTIONS} endpoint="/api/lists" />
    {error && <p role="alert" className="StatusTextError">{error}</p>}
    {forms.map((form) => <FormComponent key={form.id} title={form.name} description={form.description}
      questions={form.fields.map((field) => ({ label: typeof field === 'string' ? field : field.label }))}
      endpoint={`/api/forms/${form.id}`} />)}
  </div>;
}
