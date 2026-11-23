import React from 'react';
import { usePageContent } from '../utils/PageContentContext';
import EditablePage from '../components/EditablePage';
import Timetable from '../components/Timetable';

export default function DisciplinesPage() {
  const copy = usePageContent('disciplines');
  const disciplines = ['slalom', 'polo', 'sprint', 'whitewater', 'touring', 'surf', 'canoe', 'paddleboarding'].map((id) => ({
    id,
    name: copy[`${id}Title`],
    description: copy[`${id}Body`]
  }));

  return (
    <EditablePage pageId="disciplines">
      <div className="SectionHero"><div data-tile-group="hero">
        <div className="main_tile main_tile_grey" data-tile-id="hero">
          <h1 className="page_heading_bold_1" data-content-field="title">{copy.title}</h1>
          <p className="text_container text_container_intro" data-content-field="intro">{copy.intro}</p>
        </div></div>
      </div>

      <div className="SectionBottom">
        <div className="discipline_tile_grid" data-tile-group="tiles">
          {disciplines.map((d) => (
            <div key={d.id} className="main_tile" data-tile-id={d.id}>
              <span className="tile_eyebrow">Discipline</span>
              <h3 className="tile_heading_bold_2" data-content-field={`${d.id}Title`}>{d.name}</h3>
              <p className="text_container" data-content-field={`${d.id}Body`}>{d.description}</p>
            </div>
          ))}
        </div>
        <Timetable />
      </div>

      <div className="SectionContent" data-tile-group="support">
        <div className="main_tile main_tile_grey" data-tile-id="supported">
          <span className="tile_eyebrow">Supported paddling</span>
          <h2 className="tile_heading_bold_1" data-content-field="supportedTitle">{copy.supportedTitle}</h2>
          <p className="text_container SpaceT4 SpaceB4" data-content-field="supportedBody">{copy.supportedBody}</p>
          <div className="EverythingElseActions">
            <a className="PrimaryActionButton" data-content-field="supportedCoordinatorLabel" data-link-field="supportedCoordinatorUrl" href={copy.supportedCoordinatorUrl}>{copy.supportedCoordinatorLabel}</a>
            <a className="ContentLink" data-content-field="supportedProjectLabel" data-link-field="supportedProjectUrl" href={copy.supportedProjectUrl}>{copy.supportedProjectLabel}</a>
          </div>
        </div>
      </div>
    </EditablePage>
  );
}
