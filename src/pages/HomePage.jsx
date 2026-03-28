import React from 'react';
import { ArrowRight, MapPin, ExternalLink, Heart } from 'lucide-react';

const SPONSORS = [
  { name: 'Garfield Weston Foundation', url: 'https://garfieldweston.org/' },
  { name: 'Paddle Scotland', url: 'https://www.paddlescotland.org.uk/' },
  { name: 'SportScotland', url: 'https://sportscotland.org.uk/' },
  { name: 'City of Edinburgh Council', url: 'https://www.edinburgh.gov.uk/' },
  { name: 'Andy Jackson Fund for Access', url: 'https://www.andyjacksonfund.org.uk/' },
  { name: 'Analog Devices', url: 'https://www.analog.com/' },
  { name: 'Boroughmuir High School', url: 'https://boroughmuirhighschool.org/' },
  { name: 'National Lottery Community Fund', url: 'https://www.tnlcommunityfund.org.uk/' },
  { name: 'Scottish Building Society', url: 'https://www.scottishbs.co.uk/' },
];

export default function HomePage({ onNavigate }) {
  return (
    <div className="PageFadeIn">
      {/* Welcome + Where to Start */}
      <div className="SectionHero">
        <div className="CardGrid2Lg">
          <div className="ContentPanel">
            <h2 className="ContentTitleLg">Welcome</h2>
            <div className="ContentBody ContentBodySpaced">
              <p>
                Welcome to Forth Canoe Club. We're a local, open, active, and friendly
                kayaking / canoeing club, right in the heart of Edinburgh. We can't wait to have
                you join us on the water!
              </p>
              <p>
                If you're a complete beginner or a bit scared to start, don't let that get in the
                way — that's what we're here for!
              </p>
              <p>
                We also cater to experienced, adventurous paddlers, already involved in a
                specific discipline or keen to compete.{' '}
                <button onClick={() => onNavigate('membership')}>
                  All are most welcome members.
                </button>
              </p>
              <p>
                Total beginners might find the easiest way to get started is at one of our{' '}
                <button onClick={() => onNavigate('beginners')}>
                  open nights
                </button>{' '}
                — usually held on the first Thursday of every month.
              </p>
              <p>
                Any questions,{' '}
                <button onClick={() => onNavigate('contact-us')}>get in touch</button>.
              </p>
            </div>
          </div>

          <div className="ContentPanel">
            <h2 className="ContentTitleLg">Where to Start</h2>
            <div className="ContentBody">
              <p className="SpaceB3">Here are a few useful details:</p>
              <ul>
                <li>
                  <span>
                    <a href="https://maps.app.goo.gl/forthcanoeclub" target="_blank" rel="noreferrer">
                      This map
                    </a>{' '}
                    marks our clubhouse on Edinburgh's Union Canal, where many of our activities take place.
                  </span>
                </li>
                <li>
                  <span>
                    Our{' '}
                    <button onClick={() => onNavigate('contact-us')}>
                      contact details are here
                    </button>.
                  </span>
                </li>
                <li>
                  <span>Children need to be 8 or older to join a kids class or to paddle in a one-person boat. Children under 8 can come to an open night, paddling together with a supervising adult in an open canoe.</span>
                </li>
                <li>
                  <span>Young people under 16 must be supervised by an accompanying adult at club nights.</span>
                </li>
                <li>
                  <span>
                    Information about our classes is on the{' '}
                    <button onClick={() => onNavigate('disciplines')}>
                      disciplines page
                    </button>.
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
          <span className="ShopItemEyebrow">Registered Scottish Charity SC050275</span>
          <h3 className="ContentTitleLg SpaceT2 SpaceB4">Our Mission</h3>
          <p className="ContentBody SpaceB6">
            Forth Canoe Club is a registered Scottish Charity (SC050275) and is set up for the
            advancement of public participation in sport. In particular we seek to do the following:
          </p>
          <ol className="MissionList">
            <li className="MissionItem">
              <span className="MissionNumber">1</span>
              <div>
                <h4 className="MissionHeading">Foster, develop and advance public participation in paddle sports</h4>
              </div>
            </li>
            <li className="MissionItem">
              <span className="MissionNumber">2</span>
              <div>
                <h4 className="MissionHeading SpaceB1">Organise recreational and competitive activities</h4>
                <p className="ContentBody">
                  For the practice of the sport of canoeing and kayaking. We support club members to gain awards,
                  provide training and coaching, and provide opportunities for members to try different water sports activities.
                </p>
              </div>
            </li>
            <li className="MissionItem">
              <span className="MissionNumber">3</span>
              <div>
                <h4 className="MissionHeading SpaceB1">Increase participation for individuals with disabilities</h4>
                <p className="ContentBody">
                  To strive to increase participation in sport and recreation for individuals with disabilities
                  or those facing barriers to other sports, by creating supportive environments, providing
                  necessary resources, and championing adaptive sports initiatives.
                </p>
              </div>
            </li>
          </ol>
          <div className="SpaceT8">
            <a
              href="https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC050275"
              target="_blank"
              rel="noreferrer"
              className="PrimaryActionButton"
            >
              View on Charity Register <ExternalLink className="IconSm" />
            </a>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="SectionContent">
        <div className="CardGrid3">
          <div className="ShopItemCard">
            <div className="ShopItemHeader">
              <span className="ShopItemEyebrow">Get Started</span>
              <h3 className="ShopItemTitle">New to Paddling?</h3>
            </div>
            <p className="ShopItemBody">
              Come along to one of our beginner sessions — no experience needed. We provide all kit and coaching.
              Your first 3 trial sessions are free.
            </p>
            <button onClick={() => onNavigate('beginners')} className="PrimaryActionButton PushBottom">
              Beginners <ArrowRight className="IconSm" />
            </button>
          </div>

          <div className="ShopItemCard">
            <div className="ShopItemHeader">
              <span className="ShopItemEyebrow">Membership</span>
              <h3 className="ShopItemTitle">Join the Club</h3>
            </div>
            <p className="ShopItemBody">
              Membership runs from 1 March each year. Subscribe for coached sessions, kit hire
              and access to our full programme of events and trips.
            </p>
            <button onClick={() => onNavigate('membership')} className="PrimaryActionButton PushBottom">
              Membership <ArrowRight className="IconSm" />
            </button>
          </div>

          <div className="ShopItemCard">
            <div className="ShopItemHeader">
              <span className="ShopItemEyebrow">Get Involved</span>
              <h3 className="ShopItemTitle">Volunteer</h3>
            </div>
            <p className="ShopItemBody">
              Our club runs on volunteers. Help with coaching, events, maintenance or administration
              and earn discount codes for your membership.
            </p>
            <button onClick={() => onNavigate('volunteering')} className="PrimaryActionButton PushBottom">
              Volunteering <ArrowRight className="IconSm" />
            </button>
          </div>
        </div>
      </div>

      {/* Sponsors */}
      <div className="SectionContent">
        <div className="ContentPanel ContentPanelMuted">
          <div className="EyebrowRow">
            <Heart className="IconMd IconAccent" />
            <span className="ShopItemEyebrow">Thank You</span>
          </div>
          <h3 className="ContentTitle SpaceB6">
            Massive Thank You to All Our Access Project & Club Supporters
          </h3>
          <div className="SponsorGrid">
            {SPONSORS.map((s) => (
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
            <span className="ShopItemEyebrow">Find Us</span>
          </div>
          <h3 className="ContentTitle SpaceB1">Harrison Park, Polwarth</h3>
          <p className="ContentBody">
            Edinburgh EH11 1ED — On the Union Canal, just west of the city centre.
          </p>
        </div>
      </div>
    </div>
  );
}
