import React from 'react';
import FormComponent from '../components/FormComponent';
import { usePageContent } from '../utils/PageContentContext';
import EditablePage from '../components/EditablePage';

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
    <EditablePage pageId="volunteering">
      <div className="SectionHero"><div data-tile-group="hero">
        <div className="main_tile main_tile_grey" data-tile-id="hero">
          <h2 className="page_heading_bold_1" data-content-field="title">{copy.title}</h2>
          <p className="text_container text_container_intro" data-content-field="intro">{copy.intro}</p>
        </div></div>
      </div>

      <div className="SectionContent">
        <div className="tile_grid_three_desktop" data-tile-group="tiers">
          <div className="main_tile" data-tile-id="tier1">
            <span className="tile_eyebrow" data-content-field="tier1Eyebrow">{copy.tier1Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tier1Title">{copy.tier1Title}</h3>
            <p className="text_container" data-content-field="tier1Body">{copy.tier1Body}</p>
          </div>
          <div className="main_tile" data-tile-id="tier2">
            <span className="tile_eyebrow" data-content-field="tier2Eyebrow">{copy.tier2Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tier2Title">{copy.tier2Title}</h3>
            <p className="text_container" data-content-field="tier2Body">{copy.tier2Body}</p>
          </div>
          <div className="main_tile" data-tile-id="tier3">
            <span className="tile_eyebrow" data-content-field="tier3Eyebrow">{copy.tier3Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tier3Title">{copy.tier3Title}</h3>
            <p className="text_container" data-content-field="tier3Body">{copy.tier3Body}</p>
          </div>
        </div>
      </div>

      <div className="SectionContent"><div data-tile-group="ways">
        <div className="main_tile main_tile_grey" data-tile-id="ways">
          <h3 className="tile_heading_bold_1" data-content-field="waysTitle">{copy.waysTitle}</h3>
          <ul className="text_container SpaceY2 SpaceT4" data-content-field="waysList">
            {opportunities.map((item) => <li key={item.title}>• <strong>{item.title}</strong>{item.description && ` — ${item.description}`}</li>)}
          </ul>
        </div></div>
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
    </EditablePage>
  );
}
