import React, { useEffect, useRef, useState } from 'react';
import EditablePage from '../components/EditablePage';
import { usePageContent } from '../utils/PageContentContext';

const TABS = [
  { id: 'faq', title: 'FAQ' },
  { id: 'history', title: 'History' },
  { id: 'magazine', title: 'Kayak Magazine' }
];

const tabFromHash = () => {
  const hash = window.location.hash.slice(1);
  return TABS.some((tab) => tab.id === hash) ? hash : 'faq';
};

const FAQ_ITEMS = [
  ['trial', 'faqTrialHeading', 'faqTrialAnswer'],
  ['membership', 'faqMembershipHeading', 'faqMembershipAnswer'],
  ['what-to-bring', 'faqWhatToBringHeading', 'faqWhatToBringAnswer'],
  ['children', 'faqChildrenHeading', 'faqChildrenAnswer'],
  ['hire', 'faqHireHeading', 'faqHireAnswer'],
  ['trips', 'faqTripsHeading', 'faqTripsAnswer'],
  ['experienced', 'faqExperiencedHeading', 'faqExperiencedAnswer'],
  ['supported', 'faqSupportedHeading', 'faqSupportedAnswer']
];

export default function EverythingElsePage() {
  const copy = usePageContent('everything-else');
  const [selectedId, setSelectedId] = useState(tabFromHash);
  const tabRefs = useRef({});

  useEffect(() => {
    const followHash = () => setSelectedId(tabFromHash());
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  const selectTab = (id, focus = false) => {
    setSelectedId(id);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`);
    if (focus) tabRefs.current[id]?.focus();
  };

  const onTabKeyDown = (event, index) => {
    const movement = { ArrowRight: 1, ArrowLeft: -1 };
    let next = null;
    if (Object.hasOwn(movement, event.key)) next = (index + movement[event.key] + TABS.length) % TABS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectTab(TABS[next].id, true);
  };

  return (
    <EditablePage pageId="everything-else">
      <div className="SectionHero">
        <div data-tile-group="hero">
          <div className="main_tile main_tile_grey" data-tile-id="hero">
            <h1 className="page_heading_bold_1" data-content-field="title">{copy.title}</h1>
            <p className="text_container text_container_intro" data-content-field="intro">{copy.intro}</p>
          </div>
        </div>
      </div>

      <div className="SectionBottom">
        <div className="NoticeLayout EverythingElseLayout">
          <div className="NoticeTabs" role="tablist" aria-label="Everything Else" aria-orientation="horizontal" data-editor-control="true">
            {TABS.map((tab, index) => (
              <button
                key={tab.id}
                ref={(element) => { tabRefs.current[tab.id] = element; }}
                id={`everything-else-tab-${tab.id}`}
                type="button"
                role="tab"
                className="NoticeTab"
                aria-selected={selectedId === tab.id}
                aria-controls="everything-else-panel"
                tabIndex={selectedId === tab.id ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {tab.title}{tab.id !== 'faq' && <span className="EverythingElseDraftTab"> (draft)</span>}
              </button>
            ))}
          </div>

          <section className="NoticePanel" role="tabpanel" id="everything-else-panel" aria-labelledby={`everything-else-tab-${selectedId}`} tabIndex={0}>
            {selectedId === 'faq' && <>
              <header className="NoticePanelHeader">
                <h2 className="tile_heading_bold_1">Frequently asked questions</h2>
              </header>
              <div className="EverythingElseFaqList" data-tile-group="faq">
                {FAQ_ITEMS.map(([id, question, answer]) => (
                  <details key={id} className="main_tile EverythingElseFaqItem" data-tile-id={id}>
                    <summary className="tile_heading_bold_2" data-content-field={question}>{copy[question]}</summary>
                    <p className="text_container SpaceT3 AdminPreserveLines" data-content-field={answer}>{copy[answer]}</p>
                  </details>
                ))}
              </div>
            </>}
            {selectedId === 'history' && <>
              <header className="NoticePanelHeader">
                <span className="EverythingElseDraftLabel">Draft — awaiting review</span>
              </header>
              <div className="EverythingElseDraftPanel" data-tile-group="history">
                <div className="main_tile" data-tile-id="history">
                  <h2 className="tile_heading_bold_1" data-content-field="historyTitle">{copy.historyTitle}</h2>
                  <p className="text_container AdminPreserveLines" data-content-field="historyBody">{copy.historyBody}</p>
                </div>
              </div>
            </>}
            {selectedId === 'magazine' && <>
              <header className="NoticePanelHeader">
                <span className="EverythingElseDraftLabel">Draft — awaiting review</span>
              </header>
              <div className="EverythingElseDraftPanel" data-tile-group="magazine">
                <div className="main_tile" data-tile-id="magazine">
                  <h2 className="tile_heading_bold_1" data-content-field="magazineTitle">{copy.magazineTitle}</h2>
                  <p className="text_container AdminPreserveLines" data-content-field="magazineBody">{copy.magazineBody}</p>
                </div>
              </div>
            </>}
          </section>
        </div>
      </div>
    </EditablePage>
  );
}
