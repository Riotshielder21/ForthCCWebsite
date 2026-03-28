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
        <div className="BrandLockup" onClick={() => handleNav('HOME')}>
          <div className="BrandMarkWrap">
            <img src={fccLogoMark} alt="FCC" className="BrandMark" />
          </div>
          <div>
            <h1 className="BrandTitle">Forth Canoe<br />Club SCIO</h1>
          </div>
        </div>

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
          <button onClick={onCartOpen} className="CartToggleButton">
            <ShoppingCart className="IconLg" />
            {cartCount > 0 && (
              <span className="CartToggleBadge">{cartCount}</span>
            )}
          </button>
          <button onClick={() => setMobileOpen(!mobileOpen)} className="MobileMenuButton">
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
