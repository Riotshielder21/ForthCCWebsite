import React from 'react';
import { ExternalLink } from 'lucide-react';
import { usePageContent } from '../utils/PageContentContext';
import EditablePage from '../components/EditablePage';
import Timetable from '../components/Timetable';
import { calculateCart } from '../utils/pricing';

const money = (amount) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);

export default function BeginnersPage({ onNavigate, regularSessions, regularSessionsError, products = [] }) {
  const copy = usePageContent('beginners');
  const hireProduct = products.find((product) => product.id === 'boat-hire' && product.active !== false);
  const hirePrice = hireProduct ? calculateCart([{ ...hireProduct, clubYearChoice: 'this' }], true).items[0]?.displayPrice ?? null : null;
  return (
    <EditablePage pageId="beginners">
      <div className="SectionHero"><div data-tile-group="hero">
        <div className="main_tile main_tile_grey" data-tile-id="hero">
          <h2 className="page_heading_bold_1" data-content-field="title">{copy.title}</h2>
          <p className="text_container text_container_intro" data-content-field="intro">{copy.intro}</p>
        </div></div>
      </div>

      <div className="SectionBottom">
        <div className="tile_grid_two" data-tile-group="tiles">
          <div className="main_tile" data-tile-id="open">
            <span className="tile_eyebrow" data-content-field="openEyebrow">{copy.openEyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="openTitle">{copy.openTitle}</h3>
            <p className="text_container SpaceB4" data-content-field="openBody">{copy.openBody}</p>
            <p className="text_container text_container_note SpaceB4" data-content-field="youthNote">
              {copy.youthNote}
            </p>
            <a data-link-field="openUrl" href={copy.openUrl} target="_blank" rel="noreferrer" className="PrimaryActionButton">
              <span data-content-field="openAction">{copy.openAction}</span> <ExternalLink className="IconSm" />
            </a>
          </div>

          <div className="main_tile" data-tile-id="club">
            <span className="tile_eyebrow" data-content-field="clubEyebrow">{copy.clubEyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="clubTitle">{copy.clubTitle}</h3>
            <p className="text_container SpaceB4" data-content-field="clubBody">{copy.clubBody}</p>
            <p className="text_container text_container_note" data-content-field="clubNote">{copy.clubNote}</p>
          </div>

          <div className="main_tile" data-tile-id="courses">
            <span className="tile_eyebrow" data-content-field="coursesEyebrow">{copy.coursesEyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="coursesTitle">{copy.coursesTitle}</h3>
            <p className="text_container" data-content-field="coursesBody">{copy.coursesBody}</p>
          </div>

          <div className="main_tile main_tile_flex" data-tile-id="essentials">
            <span className="tile_eyebrow" data-content-field="essentialsEyebrow">{copy.essentialsEyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="essentialsTitle">{copy.essentialsTitle}</h3>
            <p className="text_container text_container_grow AdminPreserveLines" data-content-field="essentialsBody">{copy.essentialsBody}</p>
          </div>
        </div>
      </div>
      {hirePrice !== null && <div className="SectionContent">
        <p className="text_container">Annual boat &amp; kit hire for the current club year is {money(hirePrice)} at today’s catalogue price. See <a className="ContentLink" href="/membership">Membership</a> for current options.</p>
      </div>}
      <div className="SectionBottom">
        <Timetable sessions={regularSessions} scheduleError={regularSessionsError} />
      </div>
    </EditablePage>
  );
}
