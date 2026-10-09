import React from 'react';
import { usePageContent } from '../utils/PageContentContext';

export default function DisciplinesPage() {
  const copy = usePageContent('disciplines');
  const disciplines = ['slalom', 'polo', 'sprint', 'whitewater', 'touring', 'surf', 'canoe', 'paddleboarding'].map((id) => ({
    name: copy[`${id}Title`],
    description: copy[`${id}Body`]
  }));

  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <h2 className="PageTitle">{copy.title}</h2>
          <p className="ContentBody ContentBodyIntro">{copy.intro}</p>
        </div>
      </div>

      <div className="SectionBottom">
        <div className="DisciplineGrid">
          {disciplines.map((d) => (
            <div key={d.name} className="ContentPanel">
              <span className="ShopItemEyebrow">Discipline</span>
              <h3 className="ContentTitle SpaceT2">{d.name}</h3>
              <p className="ContentBody">{d.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
