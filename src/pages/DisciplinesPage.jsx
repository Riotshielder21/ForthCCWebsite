import React from 'react';
import { usePageContent } from '../utils/PageContentContext';
import EditablePage from '../components/EditablePage';

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
          <h2 className="page_heading_bold_1" data-content-field="title">{copy.title}</h2>
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
      </div>
    </EditablePage>
  );
}
