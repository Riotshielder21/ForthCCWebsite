import React from 'react';
import { ExternalLink } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <span className="ShopItemEyebrow">Scottish Charity SC050275</span>
          <h2 className="PageTitle SpaceT2">About Us</h2>
          <p className="ContentBody ContentBodyIntro">
            Forth Canoe Club is a Scottish Charitable Incorporated Organisation (SCIO), charity number SC050275,
            based at Harrison Park on the Union Canal in Edinburgh.
          </p>
          <div className="SpaceT6">
            <a
              href="https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC050275"
              target="_blank"
              rel="noreferrer"
              className="PrimaryActionButton"
            >
              Charity Register <ExternalLink className="IconSm" />
            </a>
          </div>
        </div>
      </div>

      <div className="SectionBottom">
        <div className="CardGrid2">
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Our Story</span>
            <h3 className="ContentTitle SpaceT2">The Club</h3>
            <p className="ContentBody">
              Forth Canoe Club is one of Edinburgh's longest-running paddling clubs. We're welcoming, open, and active, catering to paddlers of all ages and abilities. Whether you want to race competitively, explore Scotland's rivers, or simply enjoy time on the water, there's a place for you at FCC.
            </p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Community Run</span>
            <h3 className="ContentTitle SpaceT2">Governed by Members</h3>
            <p className="ContentBody">
              As a Scottish Charitable Incorporated Organisation (SCIO), we're run entirely by our members through an elected committee. We hold an Annual General Meeting each year where members shape the club's direction. All surplus funds are reinvested into equipment, coaching, and facilities.
            </p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Affiliation</span>
            <h3 className="ContentTitle SpaceT2">Paddle Scotland</h3>
            <p className="ContentBody">
              We are affiliated with Paddle Scotland (formerly SCA) and Paddle UK. Club membership includes PS affiliation, giving you access to coaching awards, insurance, competitions, and events across Scotland.
            </p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">Safeguarding</span>
            <h3 className="ContentTitle SpaceT2">Safety First</h3>
            <p className="ContentBody">
              We take safeguarding seriously. All coaches hold current PVG disclosures and follow Paddle Scotland safeguarding policies. We have a dedicated Safeguarding Officer to ensure a safe environment for all members, especially young people and vulnerable adults.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
