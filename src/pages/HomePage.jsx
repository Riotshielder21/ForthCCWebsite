import React from 'react';
import { ArrowRight, MapPin, ExternalLink, Heart } from 'lucide-react';
import { usePageContent } from '../utils/PageContentContext';

export default function HomePage({ onNavigate }) {
  const copy = usePageContent('home');
  const sponsors = copy.sponsors.split('\n').map((line) => {
    const [name, url] = line.split('|').map((value) => value.trim());
    return { name, url };
  }).filter((sponsor) => sponsor.name);

  return (
    <div className="PageFadeIn">
      {/* Welcome + Where to Start */}
      <div className="SectionHero">
        <div className="CardGrid2Lg">
          <div className="ContentPanel">
            <h2 className="ContentTitleLg">{copy.welcomeTitle}</h2>
            <div className="ContentBody ContentBodySpaced">
              <p>{copy.welcome1}</p>
              <p>{copy.welcome2}</p>
              <p>
                {copy.welcome3}{' '}
                <button onClick={() => onNavigate('membership')}>
                  {copy.welcome3Link}
                </button>{copy.welcome3After}
              </p>
              <p>
                {copy.welcome4Before}{' '}
                <button onClick={() => onNavigate('beginners')}>
                  {copy.welcome4Link}
                </button>{' '}{copy.welcome4After}
              </p>
              <p>
                {copy.welcome5Before}{' '}
                <button onClick={() => onNavigate('contact-us')}>{copy.welcome5Link}</button>{copy.welcome5After}
              </p>
            </div>
          </div>

          <div className="ContentPanel">
            <h2 className="ContentTitleLg">{copy.startTitle}</h2>
            <div className="ContentBody">
              <p className="SpaceB3">{copy.startIntro}</p>
              <ul>
                <li>
                  <span>
                    <a href={copy.start1Url} target="_blank" rel="noreferrer">
                      {copy.start1Link}
                    </a>{' '}
                    {copy.start1}
                  </span>
                </li>
                <li>
                  <span>
                    {copy.start2Before}{' '}
                    <button onClick={() => onNavigate('contact-us')}>
                      {copy.start2Link}
                    </button>{copy.start2After}
                  </span>
                </li>
                <li>
                    <span>{copy.start3}</span>
                </li>
                <li>
                    <span>{copy.start4}</span>
                </li>
                <li>
                  <span>
                    {copy.start5Before}{' '}
                    <button onClick={() => onNavigate('disciplines')}>
                      {copy.start5Link}
                    </button>{copy.start5After}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Our Mission */}
      <div className="SectionContent">
        <div className="ContentPanel ContentPanelMuted">
          <span className="ShopItemEyebrow">{copy.charityEyebrow}</span>
          <h3 className="ContentTitleLg SpaceT2 SpaceB4">{copy.missionTitle}</h3>
          <p className="ContentBody SpaceB6">{copy.missionIntro}</p>
          <ol className="MissionList">
            <li className="MissionItem">
              <span className="MissionNumber">1</span>
              <div>
                <h4 className="MissionHeading">{copy.mission1}</h4>
              </div>
            </li>
            <li className="MissionItem">
              <span className="MissionNumber">2</span>
              <div>
                <h4 className="MissionHeading SpaceB1">{copy.mission2Title}</h4>
                <p className="ContentBody">{copy.mission2}</p>
              </div>
            </li>
            <li className="MissionItem">
              <span className="MissionNumber">3</span>
              <div>
                <h4 className="MissionHeading SpaceB1">{copy.mission3Title}</h4>
                <p className="ContentBody">{copy.mission3}</p>
              </div>
            </li>
          </ol>
          <div className="SpaceT8">
            <a
              href={copy.charityUrl}
              target="_blank"
              rel="noreferrer"
              className="PrimaryActionButton"
            >
              {copy.charityLink} <ExternalLink className="IconSm" />
            </a>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="SectionContent">
        <div className="CardGrid3">
          <div className="ShopItemCard">
            <div className="ShopItemHeader">
              <span className="ShopItemEyebrow">{copy.quick1Eyebrow}</span>
              <h3 className="ShopItemTitle">{copy.quick1Title}</h3>
            </div>
            <p className="ShopItemBody">{copy.quick1Body}</p>
            <button onClick={() => onNavigate('beginners')} className="PrimaryActionButton PushBottom">
              {copy.quick1Action} <ArrowRight className="IconSm" />
            </button>
          </div>

          <div className="ShopItemCard">
            <div className="ShopItemHeader">
              <span className="ShopItemEyebrow">{copy.quick2Eyebrow}</span>
              <h3 className="ShopItemTitle">{copy.quick2Title}</h3>
            </div>
            <p className="ShopItemBody">{copy.quick2Body}</p>
            <button onClick={() => onNavigate('membership')} className="PrimaryActionButton PushBottom">
              {copy.quick2Action} <ArrowRight className="IconSm" />
            </button>
          </div>

          <div className="ShopItemCard">
            <div className="ShopItemHeader">
              <span className="ShopItemEyebrow">{copy.quick3Eyebrow}</span>
              <h3 className="ShopItemTitle">{copy.quick3Title}</h3>
            </div>
            <p className="ShopItemBody">{copy.quick3Body}</p>
            <button onClick={() => onNavigate('volunteering')} className="PrimaryActionButton PushBottom">
              {copy.quick3Action} <ArrowRight className="IconSm" />
            </button>
          </div>
        </div>
      </div>

      {/* Sponsors */}
      <div className="SectionContent">
        <div className="ContentPanel ContentPanelMuted">
          <div className="EyebrowRow">
            <Heart className="IconMd IconAccent" />
            <span className="ShopItemEyebrow">{copy.supportersEyebrow}</span>
          </div>
          <h3 className="ContentTitle SpaceB6">{copy.supportersTitle}</h3>
          <div className="SponsorGrid">
            {sponsors.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="SponsorCard"
              >
                <span className="SponsorName">
                  {s.name}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="SectionBottom">
        <div className="ContentPanel ContentPanelMuted">
          <div className="EyebrowRow">
            <MapPin className="IconLg IconAccent" />
            <span className="ShopItemEyebrow">{copy.locationEyebrow}</span>
          </div>
          <h3 className="ContentTitle SpaceB1">{copy.locationTitle}</h3>
          <p className="ContentBody">{copy.locationBody}</p>
        </div>
      </div>
    </div>
  );
}
