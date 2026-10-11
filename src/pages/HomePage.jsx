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
              <p>
                <span data-content-field="welcome3">{copy.welcome3}</span>{' '}
                <button data-content-field="welcome3Link" onClick={() => onNavigate('membership')}>
                  {copy.welcome3Link}
                </button><span data-content-field="welcome3After">{copy.welcome3After}</span>
              </p>
              <p>
                <span data-content-field="welcome4Before">{copy.welcome4Before}</span>{' '}
                <button data-content-field="welcome4Link" onClick={() => onNavigate('beginners')}>
                  {copy.welcome4Link}
                </button>{' '}<span data-content-field="welcome4After">{copy.welcome4After}</span>
              </p>
              <p>
                <span data-content-field="welcome5Before">{copy.welcome5Before}</span>{' '}
                <button data-content-field="welcome5Link" onClick={() => onNavigate('contact-us')}>{copy.welcome5Link}</button><span data-content-field="welcome5After">{copy.welcome5After}</span>
              </p>
            </div>
          </div>

          <div className="main_tile" data-tile-id="start">
            <h2 className="tile_heading_large_bold_1" data-content-field="startTitle">{copy.startTitle}</h2>
            <div className="text_container">
              <p className="SpaceB3" data-content-field="startIntro">{copy.startIntro}</p>
              <ul>
                <li>
                  <span>
                    <a data-content-field="start1Link" data-link-field="start1Url" href={copy.start1Url} target="_blank" rel="noreferrer">
                      {copy.start1Link}
                    </a>{' '}
                    <span data-content-field="start1">{copy.start1}</span>
                  </span>
                </li>
                <li>
                  <span>
                    <span data-content-field="start2Before">{copy.start2Before}</span>{' '}
                    <button data-content-field="start2Link" onClick={() => onNavigate('contact-us')}>
                      {copy.start2Link}
                    </button><span data-content-field="start2After">{copy.start2After}</span>
                  </span>
                </li>
                <li>
                    <span data-content-field="start3">{copy.start3}</span>
                </li>
                <li>
                    <span data-content-field="start4">{copy.start4}</span>
                </li>
                <li>
                  <span>
                    <span data-content-field="start5Before">{copy.start5Before}</span>{' '}
                    <button data-content-field="start5Link" onClick={() => onNavigate('disciplines')}>
                      {copy.start5Link}
                    </button><span data-content-field="start5After">{copy.start5After}</span>
                  </span>
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
            <button onClick={() => onNavigate('beginners')} className="PrimaryActionButton PushBottom">
              <span data-content-field="quick1Action">{copy.quick1Action}</span> <ArrowRight className="IconSm" />
            </button>
          </div>

          <div className="shop_product_tile" data-tile-id="quick2">
            <div className="shop_product_header">
              <span className="tile_eyebrow" data-content-field="quick2Eyebrow">{copy.quick2Eyebrow}</span>
              <h3 className="product_heading_bold" data-content-field="quick2Title">{copy.quick2Title}</h3>
            </div>
            <p className="shop_product_description" data-content-field="quick2Body">{copy.quick2Body}</p>
            <button onClick={() => onNavigate('membership')} className="PrimaryActionButton PushBottom">
              <span data-content-field="quick2Action">{copy.quick2Action}</span> <ArrowRight className="IconSm" />
            </button>
          </div>

          <div className="shop_product_tile" data-tile-id="quick3">
            <div className="shop_product_header">
              <span className="tile_eyebrow" data-content-field="quick3Eyebrow">{copy.quick3Eyebrow}</span>
              <h3 className="product_heading_bold" data-content-field="quick3Title">{copy.quick3Title}</h3>
            </div>
            <p className="shop_product_description" data-content-field="quick3Body">{copy.quick3Body}</p>
            <button onClick={() => onNavigate('volunteering')} className="PrimaryActionButton PushBottom">
              <span data-content-field="quick3Action">{copy.quick3Action}</span> <ArrowRight className="IconSm" />
            </button>
          </div>
        </div>
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
