import React from 'react';
import Timetable from '../components/Timetable';

export default function WhatsOnPage() {
  return <div className="PageFadeIn">
    <div className="SectionHero">
      <div className="main_tile main_tile_grey">
        <h2 className="page_heading_bold_1">What's on</h2>
        <p className="text_container text_container_intro">The club's regular weekly sessions. Courses, trips and one-off events are booked on the <a href="/membership">Membership &amp; Events</a> page.</p>
      </div>
    </div>
    <div className="SectionBottom">
      <Timetable emptyMessage="No regular sessions are listed at the moment. Check back soon, or contact us for details." />
    </div>
  </div>;
}
