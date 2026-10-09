import React from 'react';
import { Mail, MapPin, ExternalLink } from 'lucide-react';
import { usePageContent } from '../utils/PageContentContext';

export default function ContactUsPage() {
  const copy = usePageContent('contact');
  const addressLines = copy.address.split('\n').filter(Boolean);
  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <h2 className="PageTitle">{copy.title}</h2>
          <p className="ContentBody ContentBodyIntro">{copy.intro}</p>
        </div>
      </div>

      <div className="SectionBottom">
        <div className="CardGrid2">
          <div className="CardSpanFull ContentPanel">
            <div className="EyebrowRow">
              <MapPin className="IconMd IconAccent" />
              <span className="ShopItemEyebrow">{copy.addressEyebrow}</span>
            </div>
            <h3 className="ContentTitle SpaceT2 SpaceB3">{copy.addressTitle}</h3>
            <p className="ContentBody SpaceB6">
              {addressLines.map((line) => <React.Fragment key={line}>{line}<br /></React.Fragment>)}<br />
              <a href={copy.mapUrl} target="_blank" rel="noreferrer" className="ContentLink">
                {copy.mapAction} →
              </a>
            </p>
          </div>

          <div className="ContentPanel">
            <div className="EyebrowRow">
              <Mail className="IconMd IconAccent" />
              <span className="ShopItemEyebrow">{copy.emailEyebrow}</span>
            </div>
            <h3 className="ContentTitle SpaceT2">{copy.emailTitle}</h3>
            <p className="ContentBody"><a href={`mailto:${copy.emailAddress}`}>{copy.emailAddress}</a><br /><br />{copy.responseTime}</p>
          </div>

          <div className="ContentPanel">
            <div className="EyebrowRow">
              <ExternalLink className="IconMd IconAccent" />
              <span className="ShopItemEyebrow">{copy.socialEyebrow}</span>
            </div>
            <h3 className="ContentTitle SpaceT2">{copy.socialTitle}</h3>
            <p className="ContentBody">
              <a href={copy.facebookUrl} target="_blank" rel="noreferrer" className="ContentLink SpaceB2">
                {copy.facebookLabel} →
              </a>
              <a href={copy.instagramUrl} target="_blank" rel="noreferrer" className="ContentLink">
                {copy.instagramLabel} →
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="SectionContent">
        <div className="ContentPanel">
          <h3 className="ContentTitle">{copy.supportTitle}</h3>
          <p className="ContentBody SpaceB3">{copy.supportBody}</p>
          <p className="ContentBody ContentBodyStrong"><a href={`mailto:${copy.supportEmail}`}>{copy.supportEmail}</a></p>
        </div>
      </div>
    </div>
  );
}
