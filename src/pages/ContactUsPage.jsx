import React from 'react';
import { Mail, MapPin, ExternalLink } from 'lucide-react';
import { usePageContent } from '../utils/PageContentContext';
import EditablePage from '../components/EditablePage';
import ContactForms from '../components/ContactForms';

export default function ContactUsPage() {
  const copy = usePageContent('contact');
  const addressLines = copy.address.split('\n').filter(Boolean);
  return (
    <EditablePage pageId="contact">
      <div className="SectionHero"><div data-tile-group="hero">
        <div className="main_tile main_tile_grey" data-tile-id="hero">
          <h2 className="page_heading_bold_1" data-content-field="title">{copy.title}</h2>
          <p className="text_container text_container_intro" data-content-field="intro">{copy.intro}</p>
        </div></div>
      </div>

      <div className="SectionBottom">
        <div className="tile_grid_two" data-tile-group="tiles">
          <div className="tile_width_full main_tile" data-tile-id="address">
            <div className="EyebrowRow">
              <MapPin className="IconMd IconAccent" />
              <span className="tile_eyebrow" data-content-field="addressEyebrow">{copy.addressEyebrow}</span>
            </div>
            <h3 className="tile_heading_bold_2" data-content-field="addressTitle">{copy.addressTitle}</h3>
            <p className="text_container SpaceB6">
              <span data-content-field="address">{addressLines.map((line) => <React.Fragment key={line}>{line}<br /></React.Fragment>)}</span><br />
              <a data-link-field="mapUrl" href={copy.mapUrl} target="_blank" rel="noreferrer" className="ContentLink">
                <span data-content-field="mapAction">{copy.mapAction}</span> →
              </a>
            </p>
          </div>

          <div className="main_tile" data-tile-id="email">
            <div className="EyebrowRow">
              <Mail className="IconMd IconAccent" />
              <span className="tile_eyebrow" data-content-field="emailEyebrow">{copy.emailEyebrow}</span>
            </div>
            <h3 className="tile_heading_bold_2" data-content-field="emailTitle">{copy.emailTitle}</h3>
            <p className="text_container"><a data-content-field="emailAddress" href={`mailto:${copy.emailAddress}`}>{copy.emailAddress}</a><br /><br /><span data-content-field="responseTime">{copy.responseTime}</span></p>
          </div>

          <div className="main_tile" data-tile-id="social">
            <div className="EyebrowRow">
              <ExternalLink className="IconMd IconAccent" />
              <span className="tile_eyebrow" data-content-field="socialEyebrow">{copy.socialEyebrow}</span>
            </div>
            <h3 className="tile_heading_bold_2" data-content-field="socialTitle">{copy.socialTitle}</h3>
            <p className="text_container">
              <a data-link-field="facebookUrl" href={copy.facebookUrl} target="_blank" rel="noreferrer" className="ContentLink SpaceB2">
                <span data-content-field="facebookLabel">{copy.facebookLabel}</span> →
              </a>
              <a data-link-field="instagramUrl" href={copy.instagramUrl} target="_blank" rel="noreferrer" className="ContentLink">
                <span data-content-field="instagramLabel">{copy.instagramLabel}</span> →
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="SectionContent"><div data-tile-group="support">
        <div className="main_tile" data-tile-id="support">
          <h3 className="tile_heading_bold_1" data-content-field="supportTitle">{copy.supportTitle}</h3>
          <p className="text_container SpaceB3" data-content-field="supportBody">{copy.supportBody}</p>
          <p className="text_container text_container_strong"><a data-content-field="supportEmail" href={`mailto:${copy.supportEmail}`}>{copy.supportEmail}</a></p>
        </div></div>
      </div>
      <ContactForms />
    </EditablePage>
  );
}
