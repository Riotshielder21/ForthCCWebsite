import React, { useState } from 'react';
import { ShoppingCart, Menu, X } from 'lucide-react';
import fccLogoMark from '../assets/fcc-logo-mark.svg';

const NAV_ITEMS = ['HOME', 'Membership', 'Beginners', 'Disciplines', 'Volunteering', 'About', 'Contact Us', 'Access Project'];

export default function SiteNavigation({ currentPage, setCurrentPage, cartCount, onCartOpen }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (item) => {
    setCurrentPage(item.toLowerCase().replace(/\s+/g, '-'));
    setMobileOpen(false);
  };

  return (
    <nav className="SiteHeader">
      <div className="SiteHeaderInner">
        <button className="BrandLockup" onClick={() => handleNav('HOME')} aria-label="Go to home page">
          <div className="BrandMarkWrap">
            <img src={fccLogoMark} alt="FCC" className="BrandMark" />
          </div>
          <div>
            <h1 className="BrandTitle">Forth Canoe<br />Club SCIO</h1>
          </div>
        </button>

        <div className="TopNav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              onClick={() => handleNav(item)}
              className={`TopNavButton ${currentPage === item.toLowerCase().replace(/\s+/g, '-') ? 'TopNavButtonActive' : 'TopNavButtonIdle'}`}
            >
              {item}
            </button>
          ))}
          <button
            onClick={onCartOpen}
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
        </div>

        <div className="MobileNavControls">
          <button
            onClick={onCartOpen}
            className="CartToggleButton"
            aria-label={`Open basket${cartCount > 0 ? `, ${cartCount} item${cartCount === 1 ? '' : 's'}` : ''}`}
          >
            <ShoppingCart className="IconLg" />
            {cartCount > 0 && (
              <span className="CartToggleBadge">{cartCount}</span>
            )}
          </button>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="MobileMenuButton"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="IconXl" /> : <Menu className="IconXl" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="MobileMenu">
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              onClick={() => handleNav(item)}
              className={`TopNavButton ${currentPage === item.toLowerCase().replace(/\s+/g, '-') ? 'TopNavButtonActive' : 'TopNavButtonIdle'}`}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
