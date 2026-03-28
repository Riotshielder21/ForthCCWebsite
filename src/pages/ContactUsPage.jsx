import React from 'react';
import { Mail, MapPin, ExternalLink } from 'lucide-react';

export default function ContactUsPage() {
  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <h2 className="PageTitle">Contact Us</h2>
          <p className="ContentBody ContentBodyIntro">
            Got a question or want to book a session? Get in touch and we'll get back to you as soon as we can.
          </p>
        </div>
      </div>

      <div className="SectionBottom">
        <div className="CardGrid2">
          <div className="CardSpanFull ContentPanel">
            <div className="EyebrowRow">
              <MapPin className="IconMd IconAccent" />
              <span className="ShopItemEyebrow">Mailing Address</span>
            </div>
            <h3 className="ContentTitle SpaceT2 SpaceB3">Find Us</h3>
            <p className="ContentBody SpaceB6">
              Forth Canoe Club<br />
              Harrison Park<br />
              Polwarth<br />
              Edinburgh EH11 1ED<br /><br />
              <a href="https://maps.app.goo.gl/forthcanoeclub" target="_blank" rel="noreferrer" className="ContentLink">
                View on maps →
              </a>
            </p>
          </div>

          <div className="ContentPanel">
            <div className="EyebrowRow">
              <Mail className="IconMd IconAccent" />
              <span className="ShopItemEyebrow">General Enquiries</span>
            </div>
            <h3 className="ContentTitle SpaceT2">Get in Touch</h3>
            <p className="ContentBody">
              secretary@<br />forthcanoeclub.co.uk<br /><br />
              We aim to respond within 48 hours.
            </p>
          </div>

          <div className="ContentPanel">
            <div className="EyebrowRow">
              <ExternalLink className="IconMd IconAccent" />
              <span className="ShopItemEyebrow">Social Media</span>
            </div>
            <h3 className="ContentTitle SpaceT2">Follow Us</h3>
            <p className="ContentBody">
              <a href="https://www.facebook.com/forth.canoeclub" target="_blank" rel="noreferrer" className="ContentLink SpaceB2">
                Facebook →
              </a>
              <a href="https://www.instagram.com/forthcanoeclub" target="_blank" rel="noreferrer" className="ContentLink">
                Instagram →
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="SectionContent">
        <div className="ContentPanel">
          <h3 className="ContentTitle">Need Special Support?</h3>
          <p className="ContentBody SpaceB3">
            If you need additional support to get involved due to disability or long-term condition, contact our Supported Paddling coordinator.
          </p>
          <p className="ContentBody ContentBodyStrong">
            supported.paddling@forthcanoeclub.co.uk
          </p>
        </div>
      </div>
    </div>
  );
}
