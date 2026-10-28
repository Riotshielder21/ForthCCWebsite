import React, { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import VolunteerForm from '../components/VolunteerForm';
import VolunteerLevelsEditor from '../components/VolunteerLevelsEditor';
import VolunteerPageEditor from '../components/VolunteerPageEditor';
import VolunteerVersionHistory from '../components/VolunteerVersionHistory';
import { apiUrl } from '../utils/api';
import { usePageEditor } from '../utils/PageContentContext';
import { DEFAULT_VOLUNTEER_BENEFITS, volunteerBenefitText } from '../utils/volunteering';
import { DEFAULT_VOLUNTEER_PAGE } from '../utils/volunteerPage';

function VolunteeringConfigBar({ adminUser, products, levels, onLevelsSaved, content, onContentSaved }) {
  const [panel, setPanel] = useState('page');
  const [saves, setSaves] = useState(0);
  const [restores, setRestores] = useState(0);
  const saved = (apply) => (value) => { apply(value); setSaves((count) => count + 1); };
  const restored = (result) => { onContentSaved(result.content); onLevelsSaved(result.tiers); setRestores((count) => count + 1); };
  return <div className="VolunteerConfigBar">
    <div className="VolunteerConfigBarHeader">
      <span className="FormLabel">Live configuration</span>
      {[['page', 'Page'], ['ways', 'Ways to volunteer'], ['levels', 'Levels'], ['form', 'Form'], ['history', 'History']].map(([id, label]) =>
        <button key={id} type="button" className="EditorCommand" aria-pressed={panel === id} onClick={() => setPanel(id)}>{label}</button>)}
    </div>
    <div hidden={panel !== 'levels'}>
      <VolunteerLevelsEditor key={`levels-${restores}`} adminUser={adminUser} products={products} levels={levels} onSaved={saved(onLevelsSaved)} />
    </div>
    <div hidden={panel === 'levels' || panel === 'history'}>
      <VolunteerPageEditor key={`content-${restores}`} adminUser={adminUser} content={content} panel={panel} onSaved={saved(onContentSaved)} />
    </div>
    {panel === 'history' && <VolunteerVersionHistory adminUser={adminUser} refreshKey={saves} onRestored={restored} />}
  </div>;
}

export default function VolunteeringPage({ products = [] }) {
  const { adminUser } = usePageEditor();
  const [configuring, setConfiguring] = useState(false);
  const [copy, setCopy] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [renewal, setRenewal] = useState(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [token] = useState(() => new URLSearchParams(window.location.search).get('volunteerRenew') || '');
  const [change] = useState(() => new URLSearchParams(window.location.search).has('change'));
  useEffect(() => {
    if (token) window.history.replaceState({}, '', window.location.pathname);
    const request = async (path) => {
      const response = await fetch(apiUrl(path));
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load volunteering.');
      return result;
    };
    let active = true;
    // The latest version comes from the server; the defaults built into the site are the fallback if it cannot be reached.
    request('/api/volunteering')
      .then((page) => { if (active) { setCopy(page.content); setTiers(page.tiers); } })
      .catch(() => { if (active) { setCopy(DEFAULT_VOLUNTEER_PAGE); setTiers(DEFAULT_VOLUNTEER_BENEFITS); setOffline(true); } });
    if (token) request(`/api/volunteers/renew/${token}`)
      .then((renewal) => { if (active) setRenewal({ ...renewal, change }); })
      .catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [token, change]);

  if (!copy) return <div className="SectionContent"><p role="status">Loading volunteering…</p></div>;

  return (
    <>
      <div className="SectionHero">
        <div className="main_tile main_tile_grey">
          <h2 className="page_heading_bold_1">{copy.title}</h2>
          <p className="text_container text_container_intro">{copy.intro}</p>
          {adminUser && offline && <p className="StatusTextError" role="alert">The live volunteering configuration could not be loaded, so the built-in default is shown. Configuration is unavailable until the server responds.</p>}
          {adminUser && !offline && <button type="button" className="PrimaryActionButtonCompact" aria-expanded={configuring}
            aria-controls="volunteering-configuration" onClick={() => setConfiguring(!configuring)}>
            <Settings2 className="IconSm" /> {configuring ? 'Close volunteering configuration' : 'Configure volunteering'}
          </button>}
        </div>
      </div>

      <div className="SectionContent">
        {adminUser && !offline && <div id="volunteering-configuration" hidden={!configuring}>
          <VolunteeringConfigBar adminUser={adminUser} products={products} levels={tiers} onLevelsSaved={setTiers}
            content={copy} onContentSaved={setCopy} />
        </div>}
        <div className="tile_grid_three_desktop">
          {tiers.map((level) => <div className="main_tile" key={level.id}>
            <span className="tile_eyebrow">{level.hours}+ hours</span>
            <h3 className="tile_heading_bold_2">{level.title}</h3>
            {level.description && <p className="text_container">{level.description}</p>}
            {volunteerBenefitText(level, products) && <p className="text_container">{volunteerBenefitText(level, products)}.</p>}
          </div>)}
        </div>
      </div>

      <div className="SectionContent">
        <div className="main_tile main_tile_grey">
          <h3 className="tile_heading_bold_1">{copy.waysTitle}</h3>
          <ul className="text_container SpaceY2 SpaceT4">
            {copy.opportunities.map((item, index) => <li key={index}><strong>{item.title}</strong>{item.description && ` — ${item.description}`}</li>)}
          </ul>
        </div>
      </div>

      <div className="SectionBottom">
        {error && <p className="StatusTextError" role="alert">{error}</p>}
        {tiers.length > 0 && (!token || renewal) && <VolunteerForm tiers={tiers} products={products} renewal={renewal} token={token}
          title={copy.formTitle} description={copy.formDescription} />}
      </div>
    </>
  );
}
