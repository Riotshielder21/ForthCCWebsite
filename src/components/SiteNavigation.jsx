import React, { useEffect, useRef, useState } from 'react';
import { ShoppingCart, Menu, X, UserRound } from 'lucide-react';
import fccCrest from '../assets/fcc-crest.png';
import { pagePath } from '../utils/routes';
import { usePageEditor } from '../utils/PageContentContext';

const PRIMARY_NAV_ITEMS = [
  { id: 'home', label: 'Home' },
  { id: 'membership', label: 'Membership' },
  { id: 'beginners', label: 'Beginners' },
  { id: 'disciplines', label: 'Disciplines' },
  { id: 'timetable', label: 'Timetable' }
];

const MORE_NAV_ITEMS = [
  { id: 'volunteering', label: 'Volunteering' },
  { id: 'about', label: 'About' },
  { id: 'contact-us', label: 'Contact Us' },
  { id: 'access-project', label: 'Access Project' }
];

export default function SiteNavigation({ currentPage, setCurrentPage, cartCount, onCartOpen }) {
  const editor = usePageEditor();
  const editing = Boolean(editor?.adminUser && editor.editMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const menuButton = useRef(null);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const handleNav = (item) => {
    setCurrentPage(item);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const navLink = (item, bubble = true) => (
    <a
      key={item.id}
      href={pagePath(item.id)}
      onClick={(event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        handleNav(item.id);
      }}
      aria-current={currentPage === item.id ? 'page' : undefined}
      className={`${bubble ? 'TopNavButton' : 'MenuNavLink'} ${currentPage === item.id ? 'TopNavButtonActive' : 'TopNavButtonIdle'}`}
    >
      {item.label}
    </a>
  );

  return (
    <>
    <header className="SiteHeader">
      <div className="SiteHeaderInner">
        <a href="/" className="BrandLockup" onClick={() => setMenuOpen(false)} aria-label="Go to home page">
          <img src={fccCrest} alt="Forth Canoe Club crest" className="BrandMark" />
          <div>
            <h1 className="BrandTitle">Forth Canoe<br />Club SCIO</h1>
          </div>
        </a>

        {desktop && <nav className="TopNav" aria-label="Primary navigation">
          {PRIMARY_NAV_ITEMS.map((item) => navLink(item))}
        </nav>}

        <div className="NavControls">
          <a
            href="/my-details"
            onClick={(event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              handleNav('my-details');
            }}
            className={`ProfileToggleButton ${currentPage === 'my-details' ? 'ProfileToggleButtonActive' : ''}`}
            aria-label="My details"
            aria-current={currentPage === 'my-details' ? 'page' : undefined}
            title="My details"
          >
            <UserRound className="IconLg" aria-hidden="true" />
          </a>
          <button
            onClick={() => {
              setMenuOpen(false);
              onCartOpen();
            }}
            className="CartToggleButton"
            aria-label={`Open basket${cartCount > 0 ? `, ${cartCount} item${cartCount === 1 ? '' : 's'}` : ''}`}
          >
            <ShoppingCart className="IconLg" />
            {cartCount > 0 && (
              <span className="CartToggleBadge">
                {cartCount}
              </span>
            )}
          </button>
          <button
            ref={menuButton}
            onClick={() => setMenuOpen(!menuOpen)}
            className="MobileMenuButton"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
          >
            {menuOpen ? <X className="IconXl" /> : <Menu className="IconXl" />}
            <span className="MenuButtonLabel">More</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="site-menu" className="MobileMenu" aria-label="Site menu">
          {!desktop && <div className="MenuPrimaryLinks">
            {PRIMARY_NAV_ITEMS.map((item) => navLink(item))}
          </div>}
          <div className="MenuMoreLinks">
            {MORE_NAV_ITEMS.map((item) => navLink(item, false))}
          </div>
        </nav>
      )}
    </header>
    {currentPage === 'home' && !desktop && !menuOpen && !editing && (
      <nav className="HomeQuickNav" aria-label="Homepage shortcuts">
        {PRIMARY_NAV_ITEMS.map((item) => navLink(item))}
      </nav>
    )}
    </>
  );
}
