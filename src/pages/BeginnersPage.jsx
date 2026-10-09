import React from 'react';
import { ExternalLink } from 'lucide-react';
import { usePageContent } from '../utils/PageContentContext';

export default function BeginnersPage({ onNavigate }) {
  const copy = usePageContent('beginners');
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
            <span className="ShopItemEyebrow">{copy.openEyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.openTitle}</h3>
            <p className="ContentBody SpaceB4">{copy.openBody}</p>
            <p className="ContentBody ContentBodyNote SpaceB4">
              {copy.youthNote}
            </p>
            <a href={copy.openUrl} target="_blank" rel="noreferrer" className="PrimaryActionButton">
              {copy.openAction} <ExternalLink className="IconSm" />
            </a>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.clubEyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.clubTitle}</h3>
            <p className="ContentBody SpaceB4">{copy.clubBody}</p>
            <p className="ContentBody ContentBodyNote">{copy.clubNote}</p>
          </div>

          <div className="ContentPanel">
            <span className="ShopItemEyebrow">{copy.coursesEyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.coursesTitle}</h3>
            <p className="ContentBody">{copy.coursesBody}</p>
          </div>

          <div className="ContentPanel ContentPanelFlex">
            <span className="ShopItemEyebrow">{copy.essentialsEyebrow}</span>
            <h3 className="ContentTitle SpaceT2">{copy.essentialsTitle}</h3>
            <p className="ContentBody ContentBodyGrow AdminPreserveLines">{copy.essentialsBody}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
