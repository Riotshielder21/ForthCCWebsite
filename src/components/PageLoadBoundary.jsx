import React from 'react';
import { reloadForNewBuild } from '../utils/staleBuild';

export default class PageLoadBoundary extends React.Component {
  state = { error: null, reloading: false };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    if (reloadForNewBuild(error)) this.setState({ reloading: true });
    else console.error('Page could not be displayed:', error);
  }
  render() {
    if (this.state.reloading) return <div className="SectionContent" role="status">Loading the latest version of the site…</div>;
    if (this.state.error) return <div className="SectionHero">
      <h2 className="page_heading_bold_1">This page could not be loaded</h2>
      <p role="alert">Check your connection and reload. If the site has just been updated, reloading will get the latest version.</p>
      <button className="PrimaryActionButtonCompact" onClick={() => window.location.reload()}>Reload page</button>
    </div>;
    return this.props.children;
  }
}
