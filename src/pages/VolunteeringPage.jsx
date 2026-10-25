import React, { useEffect, useState } from 'react';
import VolunteerForm from '../components/VolunteerForm';
import { apiUrl } from '../utils/api';
import { usePageContent } from '../utils/PageContentContext';
import EditablePage from '../components/EditablePage';

export default function VolunteeringPage({ products = [] }) {
  const copy = usePageContent('volunteering');
  const [tiers, setTiers] = useState([]);
  const [renewal, setRenewal] = useState(null);
  const [error, setError] = useState('');
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
    Promise.all([request('/api/volunteer-benefits'), token ? request(`/api/volunteers/renew/${token}`) : Promise.resolve(null)])
      .then(([benefits, renewal]) => { setTiers(benefits.tiers); setRenewal(renewal ? { ...renewal, change } : null); })
      .catch((error) => setError(error.message));
  }, [token, change]);
  const opportunities = copy.waysList.split('\n').map((line) => {
    const [title, ...description] = line.split('|').map((part) => part.trim());
    return { title, description: description.join(' | ') };
  }).filter((item) => item.title);

  return (
    <EditablePage pageId="volunteering">
      <div className="SectionHero"><div data-tile-group="hero">
        <div className="main_tile main_tile_grey" data-tile-id="hero">
          <h2 className="page_heading_bold_1" data-content-field="title">{copy.title}</h2>
          <p className="text_container text_container_intro" data-content-field="intro">{copy.intro}</p>
        </div></div>
      </div>

      <div className="SectionContent">
        <div className="tile_grid_three_desktop" data-tile-group="tiers">
          <div className="main_tile" data-tile-id="tier1">
            <span className="tile_eyebrow" data-content-field="tier1Eyebrow">{copy.tier1Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tier1Title">{copy.tier1Title}</h3>
            <p className="text_container" data-content-field="tier1Body">{copy.tier1Body}</p>
          </div>
          <div className="main_tile" data-tile-id="tier2">
            <span className="tile_eyebrow" data-content-field="tier2Eyebrow">{copy.tier2Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tier2Title">{copy.tier2Title}</h3>
            <p className="text_container" data-content-field="tier2Body">{copy.tier2Body}</p>
          </div>
          <div className="main_tile" data-tile-id="tier3">
            <span className="tile_eyebrow" data-content-field="tier3Eyebrow">{copy.tier3Eyebrow}</span>
            <h3 className="tile_heading_bold_2" data-content-field="tier3Title">{copy.tier3Title}</h3>
            <p className="text_container" data-content-field="tier3Body">{copy.tier3Body}</p>
          </div>
        </div>
      </div>

      <div className="SectionContent"><div data-tile-group="ways">
        <div className="main_tile main_tile_grey" data-tile-id="ways">
          <h3 className="tile_heading_bold_1" data-content-field="waysTitle">{copy.waysTitle}</h3>
          <ul className="text_container SpaceY2 SpaceT4" data-content-field="waysList">
            {opportunities.map((item) => <li key={item.title}>• <strong>{item.title}</strong>{item.description && ` — ${item.description}`}</li>)}
          </ul>
        </div></div>
      </div>

      <div className="SectionBottom">
        {error && <p className="StatusTextError" role="alert">{error}</p>}
        {tiers.length > 0 && (!token || renewal) && <VolunteerForm tiers={tiers} products={products} renewal={renewal} token={token}
          title={copy.formTitle} description={copy.formDescription} />}
      </div>
    </EditablePage>
  );
}
