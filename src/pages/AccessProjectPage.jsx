import React from 'react';
import { ExternalLink } from 'lucide-react';
import { usePageContent } from '../utils/PageContentContext';
import EditablePage from '../components/EditablePage';

export default function AccessProjectPage() {
  const copy = usePageContent('access-project');
  return (
    <EditablePage pageId="access-project">
      <div className="SectionHero"><div data-tile-group="hero">
        <div className="main_tile main_tile_grey" data-tile-id="hero">
          <h2 className="page_heading_bold_1" data-content-field="title">{copy.title}</h2>
          <p className="text_container text_container_intro" data-content-field="intro">{copy.intro}</p>
        </div></div>
      </div>

      <div className="SectionBottom">
        <div className="tile_grid_two" data-tile-group="tiles">
          <div className="main_tile" data-tile-id="tile1">
            <span className="tile_eyebrow" data-content-field="tile1Eyebrow">{copy.tile1Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tile1Title">{copy.tile1Title}</h3>
            <p className="text_container" data-content-field="tile1Body">{copy.tile1Body}</p>
          </div>

          <div className="main_tile" data-tile-id="tile2">
            <span className="tile_eyebrow" data-content-field="tile2Eyebrow">{copy.tile2Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tile2Title">{copy.tile2Title}</h3>
            <p className="text_container" data-content-field="tile2Body">{copy.tile2Body}</p>
          </div>

          <div className="main_tile" data-tile-id="tile3">
            <span className="tile_eyebrow" data-content-field="tile3Eyebrow">{copy.tile3Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tile3Title">{copy.tile3Title}</h3>
            <p className="text_container SpaceB4" data-content-field="tile3Body">{copy.tile3Body}</p>
            <a data-link-field="timelineUrl" href={copy.timelineUrl} target="_blank" rel="noreferrer" className="ContentLink">
              <span data-content-field="timelineAction">{copy.timelineAction}</span> →
            </a>
          </div>

          <div className="main_tile" data-tile-id="tile4">
            <span className="tile_eyebrow" data-content-field="tile4Eyebrow">{copy.tile4Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tile4Title">{copy.tile4Title}</h3>
            <p className="text_container SpaceB4" data-content-field="tile4Body">{copy.tile4Body}</p>
            <a data-link-field="donateUrl" href={copy.donateUrl} target="_blank" rel="noreferrer" className="PrimaryActionButton">
              <span data-content-field="donateAction">{copy.donateAction}</span> <ExternalLink className="IconSm" />
            </a>
          </div>
        </div>
      </div>
    </EditablePage>
  );
}
