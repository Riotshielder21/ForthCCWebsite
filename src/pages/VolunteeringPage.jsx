import React from 'react';
import FormComponent from '../components/FormComponent';
import { usePageContent } from '../utils/PageContentContext';

const VOLUNTEER_CATEGORIES = [
  'Equipment Needed',
  'Volunteer Sign-ups',
  'Event Participants',
  'Maintenance Tasks',
  'Other'
];

const handleVolunteerSuccess = (result, formData) => {
  if (formData.category === 'Volunteer Sign-ups') {
    if (result.verification?.verified) {
      return `Thank you for volunteering! Your discount code is: ${result.discountCode}`;
    }
    return 'Submitted successfully! Note: Your name was not found in our member database. Please contact us if you believe this is an error.';
  }
  return 'List submitted successfully!';
};

export default function VolunteeringPage() {
  const copy = usePageContent('volunteering');
  const opportunities = copy.waysList.split('\n').map((line) => {
    const [title, ...description] = line.split('|').map((part) => part.trim());
    return { title, description: description.join(' | ') };
  }).filter((item) => item.title);

  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <h2 className="PageTitle">{copy.title}</h2>
          <p className="ContentBody ContentBodyIntro">{copy.intro}</p>
        </div>
      </div>

      <div className="SectionContent">
        <div className="CardGrid3Lg">
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.tier1Eyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.tier1Title}</h3>
            <p className="ContentBody">{copy.tier1Body}</p>
          </div>
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.tier2Eyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.tier2Title}</h3>
            <p className="ContentBody">{copy.tier2Body}</p>
          </div>
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.tier3Eyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.tier3Title}</h3>
            <p className="ContentBody">{copy.tier3Body}</p>
          </div>
        </div>
      </div>

      <div className="SectionContent">
        <div className="ContentPanel ContentPanelMuted">
          <h3 className="ContentTitle">{copy.waysTitle}</h3>
          <ul className="ContentBody SpaceY2 SpaceT4">
            {opportunities.map((item) => <li key={item.title}>• <strong>{item.title}</strong>{item.description && ` — ${item.description}`}</li>)}
          </ul>
        </div>
      </div>

      <div className="SectionBottom">
        <FormComponent
          title={copy.formTitle}
          description={copy.formDescription}
          categories={VOLUNTEER_CATEGORIES}
          categoryLabel="List Type"
          itemsLabel="List Items"
          itemPlaceholder="Item"
          submitLabel="Submit"
          endpoint="/api/lists"
          onSuccess={handleVolunteerSuccess}
        />
      </div>
    </div>
  );
}
