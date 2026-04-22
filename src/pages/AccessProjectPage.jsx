import React from 'react';
import { ExternalLink } from 'lucide-react';

export default function AccessProjectPage() {
  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <h2 className="PageTitle">Access Project</h2>
          <p className="ContentBody ContentBodyIntro">
            Making paddling accessible to everyone. Our Access Project works to remove barriers
            and create opportunities for people who might not otherwise have access to water sports.
          </p>
        </div>
      </div>

      <div className="SectionBottom">
        <div className="CardGrid2">
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">The Challenge</span>
            <h3 className="ContentTitle SpaceT2">Our Vision</h3>
            <p className="ContentBody">
              Paddlesports can be accessible for people with disabilities. We want to be a pathway club for ParaCanoe athletes. Currently, wheelchair users must be lifted in and out of boats — we're working to change that and restore independence and autonomy. We're also advocating for accessible facilities like changing rooms and showers.
            </p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Our Approach</span>
            <h3 className="ContentTitle SpaceT2">Inclusive Design</h3>
            <p className="ContentBody">
              "It's what you can do, rather than what you can't do." We work with individuals facing barriers to paddling, adapting sessions to meet their needs. Well-designed access improves the site for everyone.
            </p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Track Progress</span>
            <h3 className="ContentTitle SpaceT2">Project Timeline</h3>
            <p className="ContentBody SpaceB4">
              We've completed feasibility studies and secured £32,000+ in pledges. We're now working through surveys, funding applications, designs, and approvals. Building work will follow once final funding is in place.
            </p>
            <a href="https://www.forthcanoeclub.co.uk/access-project" target="_blank" rel="noreferrer" className="ContentLink">
              View full timeline →
            </a>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Get Involved</span>
            <h3 className="ContentTitle SpaceT2">Support Our Work</h3>
            <p className="ContentBody SpaceB4">
              Help us make paddling accessible to everyone. Volunteer with the project, contribute skills, or donate to the fundraiser.
            </p>
            <a href="https://www.justgiving.com/campaign/forth-access-project" target="_blank" rel="noreferrer" className="PrimaryActionButton">
              Donate Now <ExternalLink className="IconSm" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
