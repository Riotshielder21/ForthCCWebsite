import React from 'react';
import { ExternalLink } from 'lucide-react';

export default function BeginnersPage({ onNavigate }) {
  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <h2 className="PageTitle">Beginners</h2>
          <p className="ContentBody ContentBodyIntro">
            Whether you're a complete beginner or returning after a long break, we welcome you. No prior experience needed. We provide all the kit and qualified instructors to help you get started safely on the water.
          </p>
        </div>
      </div>

      <div className="SectionBottom">
        <div className="CardGrid2">
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Every Thursday (April–October)</span>
            <h3 className="ContentTitle SpaceT2">Open Night</h3>
            <p className="ContentBody SpaceB4">
              No membership required. Just book online and come along. Our qualified instructors will help you get fitted with kit and guide your first steps into paddling. Sessions are around 1.5 hours and run between April and October.
            </p>
            <p className="ContentBody ContentBodyNote SpaceB4">
              <strong>For young people:</strong> Under 16s must be supervised by an adult. Children under 8 can paddle in an open canoe with a supervising adult.
            </p>
            <a href="https://events.humanitix.com/host/forth-canoe-club" target="_blank" rel="noreferrer" className="PrimaryActionButton">
              Book Open Night <ExternalLink className="IconSm" />
            </a>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Members Only</span>
            <h3 className="ContentTitle SpaceT2">Club Night</h3>
            <p className="ContentBody SpaceB4">
              After joining, come down for regular uncoached paddling sessions on Thursdays between April and October. Works best if you've attended an intro course or several open nights first. Boat hire £10 per session, or £70 per year for regular paddlers.
            </p>
            <p className="ContentBody ContentBodyNote">
              No need to book — just check club emails to confirm sessions are running.
            </p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Guided Learning</span>
            <h3 className="ContentTitle SpaceT2">Paddle Courses</h3>
            <p className="ContentBody">
              Open to members and non-members. Learn the basics and progress to more technical skills. Discover and Explore courses cover kayak, canoe, and paddle board. Kids and teens courses available during holidays and after school.
            </p>
          </div>

          <div className="ContentPanel ContentPanelFlex">
            <span className="ShopItemEyebrow">What to Bring</span>
            <h3 className="ContentTitle SpaceT2">Essentials</h3>
            <p className="ContentBody ContentBodyGrow">
              • Towel<br />• Clothes for paddling (will get wet)<br />• Warm change of clothes<br />• Flat shoes that stay on in water<br /><br />No wetsuit needed, but helpful if you have one. Basic changing rooms and portaloo available.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
