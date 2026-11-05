import React from 'react';
import { ArrowRight, MapPin, ExternalLink, Heart } from 'lucide-react';
import { usePageContent } from '../utils/PageContentContext';
import EditablePage, { SupporterTiles } from '../components/EditablePage';

export default function HomePage({ onNavigate }) {
  const copy = usePageContent('home');
  return (
    <EditablePage pageId="home">
      {/* Welcome + Where to Start */}
      <div className="SectionHero">
        <div className="tile_grid_two_desktop" data-tile-group="intro">
          <div className="main_tile" data-tile-id="welcome">
            <h2 className="tile_heading_large_bold_1" data-content-field="welcomeTitle">{copy.welcomeTitle}</h2>
            <div className="text_container text_container_spaced">
              <p data-content-field="welcome1">{copy.welcome1}</p>
              <p data-content-field="welcome2">{copy.welcome2}</p>
              <p data-content-field="welcome3Text">{copy.welcome3Text}</p>
              <p data-content-field="welcome4Text">{copy.welcome4Text}</p>
              <p data-content-field="welcome5Text">{copy.welcome5Text}</p>
            </div>
          </div>

          <div className="main_tile" data-tile-id="start">
            <h2 className="tile_heading_large_bold_1" data-content-field="startTitle">{copy.startTitle}</h2>
            <div className="text_container">
              <p className="SpaceB3" data-content-field="startIntro">{copy.startIntro}</p>
              <ul>
                <li>
                  <span data-content-field="start1Text">{copy.start1Text}</span>
                </li>
                <li>
                  <span data-content-field="start2Text">{copy.start2Text}</span>
                </li>
                <li>
                    <span data-content-field="start3">{copy.start3}</span>
                </li>
                <li>
                    <span data-content-field="start4">{copy.start4}</span>
                </li>
                <li>
                  <span data-content-field="start5Text">{copy.start5Text}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Our Mission */}
      <div className="SectionContent"><div data-tile-group="mission">
        <div className="main_tile main_tile_grey" data-tile-id="mission">
          <span className="tile_eyebrow" data-content-field="charityEyebrow">{copy.charityEyebrow}</span>
          <h3 className="tile_heading_large_bold_2" data-content-field="missionTitle">{copy.missionTitle}</h3>
          <p className="text_container SpaceB6" data-content-field="missionIntro">{copy.missionIntro}</p>
          <ol className="MissionList">
            <li className="MissionItem">
              <span className="MissionNumber">1</span>
              <div>
                <h4 className="mission_heading_bold_1" data-content-field="mission1">{copy.mission1}</h4>
              </div>
            </li>
            <li className="MissionItem">
              <span className="MissionNumber">2</span>
              <div>
                <h4 className="mission_heading_bold_2" data-content-field="mission2Title">{copy.mission2Title}</h4>
                <p className="text_container" data-content-field="mission2">{copy.mission2}</p>
              </div>
            </li>
            <li className="MissionItem">
              <span className="MissionNumber">3</span>
              <div>
                <h4 className="mission_heading_bold_2" data-content-field="mission3Title">{copy.mission3Title}</h4>
                <p className="text_container" data-content-field="mission3">{copy.mission3}</p>
              </div>
            </li>
          </ol>
          <div className="SpaceT8">
            <a
              data-link-field="charityUrl"
              href={copy.charityUrl}
              target="_blank"
              rel="noreferrer"
              className="PrimaryActionButton"
            >
              <span data-content-field="charityLink">{copy.charityLink}</span> <ExternalLink className="IconSm" />
            </a>
          </div>
        </div></div>
      </div>

      {/* Quick Links */}
      <div className="SectionContent">
        <div className="tile_grid_three" data-tile-group="quick">
          <div className="shop_product_tile" data-tile-id="quick1">
            <div className="shop_product_header">
              <span className="tile_eyebrow" data-content-field="quick1Eyebrow">{copy.quick1Eyebrow}</span>
              <h3 className="product_heading_bold" data-content-field="quick1Title">{copy.quick1Title}</h3>
            </div>
            <p className="shop_product_description" data-content-field="quick1Body">{copy.quick1Body}</p>
            <a href="/beginners" className="PrimaryActionButton PushBottom">
              <span data-content-field="quick1Action">{copy.quick1Action}</span> <ArrowRight className="IconSm" />
            </a>
          </div>

          <div className="shop_product_tile" data-tile-id="quick2">
            <div className="shop_product_header">
              <span className="tile_eyebrow" data-content-field="quick2Eyebrow">{copy.quick2Eyebrow}</span>
              <h3 className="product_heading_bold" data-content-field="quick2Title">{copy.quick2Title}</h3>
            </div>
            <p className="shop_product_description" data-content-field="quick2Body">{copy.quick2Body}</p>
            <a href="/membership" className="PrimaryActionButton PushBottom">
              <span data-content-field="quick2Action">{copy.quick2Action}</span> <ArrowRight className="IconSm" />
            </a>
          </div>

          <div className="shop_product_tile" data-tile-id="quick3">
            <div className="shop_product_header">
              <span className="tile_eyebrow" data-content-field="quick3Eyebrow">{copy.quick3Eyebrow}</span>
              <h3 className="product_heading_bold" data-content-field="quick3Title">{copy.quick3Title}</h3>
            </div>
            <p className="shop_product_description" data-content-field="quick3Body">{copy.quick3Body}</p>
            <a href="/volunteering" className="PrimaryActionButton PushBottom">
              <span data-content-field="quick3Action">{copy.quick3Action}</span> <ArrowRight className="IconSm" />
            </a>
          </div>
        </div>
      </div>

      <div className="SectionContent">
        <section className="main_tile main_tile_grey HomeSafeguardingCallout">
          <div>
            <span className="tile_eyebrow">Safeguarding</span>
            <h3 className="tile_heading_bold_2">Report a concern</h3>
            <p className="text_container">Find safeguarding information and the current reporting routes.</p>
          </div>
          <a href="/safeguarding" className="PrimaryActionButton">Safeguarding <ArrowRight className="IconSm" /></a>
        </section>
      </div>

      {/* Sponsors */}
      <div className="SectionContent"><div data-tile-group="supporters">
        <div className="main_tile main_tile_grey" data-tile-id="supporters">
          <div className="EyebrowRow">
            <Heart className="IconMd IconAccent" />
            <span className="tile_eyebrow" data-content-field="supportersEyebrow">{copy.supportersEyebrow}</span>
          </div>
          <h3 className="tile_heading_bold_spacious" data-content-field="supportersTitle">{copy.supportersTitle}</h3>
          <SupporterTiles />
        </div></div>
      </div>

      {/* Location */}
      <div className="SectionBottom"><div data-tile-group="location">
        <div className="main_tile main_tile_grey" data-tile-id="location">
          <div className="EyebrowRow">
            <MapPin className="IconLg IconAccent" />
            <span className="tile_eyebrow" data-content-field="locationEyebrow">{copy.locationEyebrow}</span>
          </div>
          <h3 className="tile_heading_bold_compact" data-content-field="locationTitle">{copy.locationTitle}</h3>
          <p className="text_container" data-content-field="locationBody">{copy.locationBody}</p>
        </div></div>
      </div>
    </EditablePage>
  );
}
