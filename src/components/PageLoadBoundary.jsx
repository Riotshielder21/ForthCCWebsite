import React from 'react';
import { reloadForNewBuild } from '../utils/staleBuild';
import { clientErrorKind } from '../utils/clientErrors';
import { reportClientError } from '../utils/reportClientError';

export default class PageLoadBoundary extends React.Component {
  state = { error: null, reloading: false };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    void reportClientError(clientErrorKind(error, 'page-render'));
    if (reloadForNewBuild(error)) this.setState({ reloading: true });
    else console.error('Page could not be displayed:', error);
  }
  render() {
    if (this.state.reloading) return <div className="SectionContent" role="status">Loading the latest version of the site…</div>;
    if (this.state.error) return <section className="SectionHero PageRecovery">
      <span className="tile_eyebrow">A little off course</span>
      <h1 className="page_heading_bold_2">Let’s try that again</h1>
      <p className="text_container" role="alert">This page couldn’t load. Check your connection, then reload.</p>
      <div className="PageRecoveryActions">
        <button type="button" className="PrimaryActionButtonCompact" onClick={() => window.location.reload()}>Reload page</button>
        <a className="EditorCommand" href="/" onClick={(event) => event.stopPropagation()}>Go home</a>
      </div>
    </section>;
    return this.props.children;
  }
}
