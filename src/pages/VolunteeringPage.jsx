import React from 'react';
import FormComponent from '../components/FormComponent';

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
  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <h2 className="PageTitle">Volunteering</h2>
          <p className="ContentBody ContentBodyIntro">
            Forth Canoe Club runs on volunteers. Every contribution — from coaching and events to maintenance and fundraising — makes a real difference. We reward volunteer commitment with substantial discounts on memberships and activities.
          </p>
        </div>
      </div>

      <div className="SectionContent">
        <div className="CardGrid3Lg">
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">20+ hours</span>
            <h3 className="ContentTitle SpaceT2">Get Started</h3>
            <p className="ContentBody">
              £5 discount per month on unlimited subscriptions + free key hire.
            </p>
          </div>
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">40+ hours</span>
            <h3 className="ContentTitle SpaceT2">Regular Volunteer</h3>
            <p className="ContentBody">
              Fixed £10/month unlimited subscriptions + free boat & equipment hire + free key hire.
            </p>
          </div>
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">60+ hours</span>
            <h3 className="ContentTitle SpaceT2">Core Team</h3>
            <p className="ContentBody">
              Free equipment hire, subscriptions, key hire, + 25% discount on coaching courses.
            </p>
          </div>
        </div>
      </div>

      <div className="SectionContent">
        <div className="ContentPanel ContentPanelMuted">
          <h3 className="ContentTitle">Ways to Volunteer</h3>
          <ul className="ContentBody SpaceY2 SpaceT4">
            <li>• <strong>Canal Festival</strong> — The most important community event of the year</li>
            <li>• <strong>Maintenance</strong> — Painting, cleaning, weeding, and building at the clubhouse</li>
            <li>• <strong>Coaching</strong> — Shadowing coaches, helping at pool and summer sessions, running beginner classes</li>
            <li>• <strong>Key Holding</strong> — Open the club for club nights and open nights</li>
            <li>• <strong>Equipment Repair</strong> — Plastic welding, carbon repairs, wooden canoe seats, airbag fixes</li>
            <li>• <strong>Fundraising</strong> — Grant applications, baking stalls, community events</li>
            <li>• <strong>Access Project</strong> — Join our subcommittee working on accessibility improvements</li>
          </ul>
        </div>
      </div>

      <div className="SectionBottom">
        <FormComponent
          title="Get Involved"
          description="Sign up for volunteering opportunities or log equipment needs."
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
