import React from 'react';
import { ExternalLink } from 'lucide-react';
import { usePageContent } from '../utils/PageContentContext';

export default function AccessProjectPage() {
  const copy = usePageContent('access-project');
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
          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.tile1Eyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.tile1Title}</h3>
            <p className="ContentBody">{copy.tile1Body}</p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.tile2Eyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.tile2Title}</h3>
            <p className="ContentBody">{copy.tile2Body}</p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.tile3Eyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.tile3Title}</h3>
            <p className="ContentBody SpaceB4">{copy.tile3Body}</p>
            <a href={copy.timelineUrl} target="_blank" rel="noreferrer" className="ContentLink">
              {copy.timelineAction} →
            </a>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.tile4Eyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.tile4Title}</h3>
            <p className="ContentBody SpaceB4">{copy.tile4Body}</p>
            <a href={copy.donateUrl} target="_blank" rel="noreferrer" className="PrimaryActionButton">
              {copy.donateAction} <ExternalLink className="IconSm" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
