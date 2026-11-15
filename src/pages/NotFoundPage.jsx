import React from 'react';

export default function NotFoundPage() {
  return <section className="SectionHero PageRecovery">
    <img className="PageRecoveryPicture" src="/images/missing-kayak.svg" width="480" height="300"
      alt="A puzzled kayaker holding a paddle above a kayak-shaped gap, while their kayak floats away." />
    <span className="tile_eyebrow">404 · Missing in action</span>
    <h1 className="page_heading_bold_2">Page not found</h1>
    <p className="text_container">The page has paddled off. Let’s get you back on course.</p>
    <nav className="PageRecoveryActions" aria-label="Find your way">
      <a className="PrimaryActionButtonCompact" href="/">Home</a>
      <a className="EditorCommand" href="/membership">Membership</a>
      <a className="EditorCommand" href="/beginners">Beginners</a>
      <a className="EditorCommand" href="/contact-us">Contact the club</a>
    </nav>
  </section>;
}
