import React from 'react';

export default function DisciplinesPage() {
  const disciplines = [
    {
      name: 'Slalom',
      description: 'Navigate downstream through hanging gates against the clock. Training Tuesday evenings at 19:00 on the canal. A technical challenge that develops precise boat control. Included in session subscriptions.',
    },
    {
      name: 'Polo',
      description: 'Team sport combining paddling and ball handling. Beginner friendly Friday 18:00, intermediate Wednesday 19:00, advanced Monday 18:00. Play in Scottish divisions or just for fun. Included in subscriptions.',
    },
    {
      name: 'Sprint & Marathon',
      description: 'Flat-water racing from sprint speed trials to long-distance marathons. Coached sessions Thursday 18:00. Compete nationally or just enjoy smooth paddling and great technique.',
    },
    {
      name: 'White Water',
      description: 'Explore Scotland\'s rivers with the rush of moving water. Includes white water trips for adventure, white water racing for speed, and river coaching. Trips organised by request.',
    },
    {
      name: 'Flat Water Touring',
      description: 'Relaxed paddling on lochs and slow rivers. Explore the Scottish landscape by boat. Perfect for those wanting to escape without the competitive edge.',
    },
    {
      name: 'Surf Kayaking',
      description: 'Ride sea swells and enjoy coastal paddling. FCC has produced world-class surf kayakers including Neil Baxter. Feel the adrenaline and fresh sea air.',
    },
  ];

  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="ContentPanel ContentPanelMuted">
          <h2 className="PageTitle">Disciplines</h2>
          <p className="ContentBody ContentBodyIntro">
            From competitive racing to relaxed touring, Forth Canoe Club covers a wide range of paddling disciplines.
          </p>
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
