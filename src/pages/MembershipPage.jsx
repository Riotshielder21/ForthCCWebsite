import React, { useEffect, useState } from 'react';
import { ShoppingCart, Plus, Minus, ExternalLink, ChevronDown, Pencil } from 'lucide-react';
import { DISCOUNTS, CATEGORIES } from '../constants/products';
import { usePageContent, usePageEditor } from '../utils/PageContentContext';
import { eventScheduleLabel } from '../utils/catalogue';
import { isTripEvent } from '../utils/tripDiscount';
import { bookingsClosed, formatDate } from '../utils/eventRoster';
import { productLimits } from '../utils/inventory';
import { scopeLabel, voucherScope } from '../utils/vouchers';
import fccBurgee from '../assets/fcc-burgee.png';

// Matches .shop_catalogue_grid: one column, two from md (768px), three from lg (1024px).
function useGridColumns() {
  const read = () => (typeof window === 'undefined' || !window.matchMedia ? 3
    : window.matchMedia('(min-width: 1024px)').matches ? 3
      : window.matchMedia('(min-width: 768px)').matches ? 2 : 1);
  const [columns, setColumns] = useState(read);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const queries = ['(min-width: 768px)', '(min-width: 1024px)'].map((query) => window.matchMedia(query));
    const update = () => setColumns(read());
    queries.forEach((query) => query.addEventListener('change', update));
    return () => queries.forEach((query) => query.removeEventListener('change', update));
  }, []);
  return columns;
}

export default function MembershipPage({ activeCategory, setActiveCategory, cart, availability = {}, stockLeft = () => Infinity, addToCart, removeOneFromCart, getItemDisplayPrice, products, onNavigate }) {
  const copy = usePageContent('membership');
  const { adminUser } = usePageEditor();
  const [selectedTier, setSelectedTier] = useState('adult');
  const [tierDropdownOpen, setTierDropdownOpen] = useState(false);
  const [sizeChoice, setSizeChoice] = useState({});
  const columns = useGridColumns();

  const membershipTiers = products.filter((product) => product.category === 'MEMBERSHIP' && product.membershipTier);
  const nonMembershipProducts = products.filter((product) => product.category !== 'MEMBERSHIP' || !product.membershipTier);
  const selectedMembership = membershipTiers.find(t => t.membershipTier === selectedTier);
  const countInCart = (id, size = '') => cart.filter((line) => line.id === id && (line.size || '') === size).length;
  const purchaseControl = (product, onAdd, size = '') => {
    const count = countInCart(product.id, size);
    const soldOut = stockLeft(product, size) <= 0;
    if (!count) {
      return (
        <button onClick={onAdd} disabled={soldOut} className="IconActionButton" aria-label={`Add ${product.name}${size ? ` (${size})` : ''} to basket`} title={soldOut ? 'Sold out' : 'Add to basket'}>
          <ShoppingCart className="IconXl" />
        </button>
      );
    }
    return (
      <div className="QuantityControl" role="group" aria-label={`${product.name}${size ? ` (${size})` : ''}: ${count} in basket`}>
        <button onClick={() => removeOneFromCart(product.id, size)} aria-label={`Remove one ${product.name}`} title="Remove one"><Minus className="IconLg" /></button>
        <span aria-hidden="true">{count}</span>
        <button onClick={onAdd} disabled={soldOut} aria-label={`Add another ${product.name}`} title={soldOut ? 'No more available' : 'Add another'}><Plus className="IconLg" /></button>
      </div>
    );
  };

  const handleAddMembership = () => {
    if (!selectedMembership) return;
    addToCart(selectedMembership);
  };

  // Sold-out events and merchandise leave the shop until an admin frees a place.
  const displayProducts = nonMembershipProducts.filter(
    (p) => (activeCategory === 'ALL' || p.category === activeCategory) && !availability[p.id]?.soldOut
  );
  // A card without a picture gets a placeholder only when another card in its grid row has one, so that row lines up.
  const showMembershipTile = Boolean(selectedMembership) && (activeCategory === 'ALL' || activeCategory === 'MEMBERSHIP');
  const tileImages = [...(showMembershipTile ? [false] : []), ...displayProducts.map((product) => Boolean(product.imageUrl))];
  const rowHasImage = (index) => {
    const start = index - (index % columns);
    return tileImages.slice(start, start + columns).some(Boolean);
  };
  const productImage = (product, index) => product?.imageUrl
    ? <img className="shop_product_image" src={product.imageUrl} alt="" />
    : rowHasImage(index) && <div className="shop_product_image shop_product_image_placeholder" aria-hidden="true"><img src={fccBurgee} alt="" /></div>;

  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="PageHero">
          <div>
            <h2 className="page_heading_bold_1">Membership and Events</h2>
            <p className="PageIntro">{copy.intro}</p>
            {adminUser && (
              <button type="button" className="PrimaryActionButtonCompact" onClick={() => { onNavigate?.('admin'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <Pencil className="IconSm" /> Edit shop
              </button>
            )}
          </div>
          <div className="CategoryBar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`CategoryButton ${activeCategory === cat ? 'CategoryButtonActive' : 'CategoryButtonIdle'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="SectionBottom">
        <div className="shop_catalogue_grid">
          {/* Membership tier card */}
          {showMembershipTile && (
            <div className="shop_product_tile">
              {productImage(null, 0)}
              <div className="shop_product_header">
                <span className="tile_eyebrow">{copy.memberEyebrow}</span>
                <h3 className="product_heading_bold">{copy.memberTitle}</h3>
              </div>
              <p className="shop_product_description">{copy.memberBody}</p>

              {/* Tier selector */}
              <div className="DropdownWrapper">
                <button
                  onClick={() => setTierDropdownOpen(!tierDropdownOpen)}
                  className="DropdownTrigger"
                >
                  <div className="DropdownTriggerValue">
                    <span className="DropdownItemLabel">
                      {selectedTier}
                    </span>
                    <span className="DropdownItemHint">
                      £{selectedMembership?.basePrice.toFixed(2)}
                    </span>
                  </div>
                  <ChevronDown className={`IconMd DropdownTriggerChevron ${tierDropdownOpen ? 'is-open' : ''}`} />
                </button>

                {tierDropdownOpen && (
                  <div className="DropdownPanel">
                    {membershipTiers.map((tier) => (
                      <button
                        key={tier.membershipTier}
                        onClick={() => { setSelectedTier(tier.membershipTier); setTierDropdownOpen(false); }}
                        className={`DropdownItem ${
                          selectedTier === tier.membershipTier ? 'DropdownItemActive' : 'DropdownItemIdle'
                        }`}
                      >
                        <div>
                          <span className="DropdownItemLabel">
                            {tier.membershipTier}
                          </span>
                          <span className="DropdownItemHint">
                            {tier.description}
                          </span>
                        </div>
                        <span className="DropdownItemPrice">
                          £{tier.basePrice.toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="shop_product_footer">
                <div>
                  <div className="shop_product_price">£{selectedMembership?.basePrice.toFixed(2)}</div>
                  <div className="shop_product_meta">{copy.clubYearPriceLabel}</div>
                </div>
                {purchaseControl(selectedMembership, handleAddMembership)}
              </div>
            </div>
          )}

          {/* All other products */}
          {displayProducts.map((product, productIndex) => {
            const merchandise = product.category === 'MERCHANDISE';
            const remaining = availability[product.id]?.remaining;
            const sizes = merchandise ? Object.keys(productLimits(product) || {}) : [];
            const inStock = (size) => !remaining || (remaining[size] ?? 0) > 0;
            const size = merchandise ? (sizeChoice[product.id] && inStock(sizeChoice[product.id]) ? sizeChoice[product.id] : sizes.find(inStock) || sizes[0] || '') : '';
            const placesLeft = product.category === 'EVENTS' ? remaining?.all : null;
            const closed = product.category === 'EVENTS' && bookingsClosed(product);
            return (
            <div key={product.id} className="shop_product_tile">
              {productImage(product, productIndex + (showMembershipTile ? 1 : 0))}
              {product.hasAnnualDiscount && (
                <div className="shop_product_badge">
                  Save {(DISCOUNTS.ANNUAL * 100).toFixed(0)}% Annually
                </div>
              )}
              <div className="shop_product_header">
                <span className="tile_eyebrow">{product.category}</span>
                <h3 className="product_heading_bold">{product.name}</h3>
              </div>
              <p className="shop_product_description">{product.description}</p>
              {product.category === 'EVENTS' && <p className="text_container SpaceB4">{eventScheduleLabel(product.eventSchedule)}</p>}
              {isTripEvent(product) && <p className="text_container text_container_note">£10 off with annual boat hire, and £10 off with a coaching subscription.</p>}
              {product.category === 'EVENTS' && product.leaderName && <p className="text_container SpaceB4">Led by {product.leaderName}{product.leaderEmail && <> (<a className="ContentLink" href={`mailto:${product.leaderEmail}`}>{product.leaderEmail}</a>)</>}</p>}
              {product.membershipRule === 'none' && <p className="text_container text_container_note">Open to non-members.</p>}
              {product.membershipRule === 'included' && <p className="text_container text_container_note">Club membership included until 1 March.</p>}
              {product.category === 'EVENTS' && product.closeDate && <p className="text_container SpaceB4">{closed ? 'Bookings have closed.' : `Book by ${formatDate(product.closeDate)}.`}</p>}
              {placesLeft > 0 && placesLeft <= 5 && <p className="text_container SpaceB4" role="status">Only {placesLeft} {placesLeft === 1 ? 'place' : 'places'} left</p>}
              {merchandise && sizes.length > 0 && (
                <label className="FormLabel SpaceB4">Size
                  <select className="FormInput" value={size} onChange={(event) => setSizeChoice((current) => ({ ...current, [product.id]: event.target.value }))}>
                    {sizes.map((option) => <option key={option} value={option} disabled={!inStock(option)}>{option}{inStock(option) ? '' : ' (sold out)'}</option>)}
                  </select>
                </label>
              )}
              <div className="shop_product_footer">
                <div>
                  {product.pricingMode === 'prorated' ? (
                    <>
                      <div className="shop_product_price">£{getItemDisplayPrice(product)}</div>
                      <div className="shop_product_meta">{copy.annualPriceLabel}</div>
                      {Number(getItemDisplayPrice(product)) < product.basePrice && <div className="KitHireMonthlyLabel">Reduced from £{product.basePrice.toFixed(2)} for the rest of the club year</div>}
                    </>
                  ) : (
                    <>
                      <div className="shop_product_price">
                        {product.priceLabel || `£${product.basePrice.toFixed(2)}`}
                      </div>
                      <div className="shop_product_meta">
                        {product.type === 'event-ticket' ? 'Event / course ticket'
                          : product.type === 'voucher'
                          ? copy.voucherPriceLabel
                          : product.type === 'merchandise' ? 'Per item'
                          : product.pricingMode === 'subscription'
                            ? copy.monthlyPriceLabel
                          : product.type === 'yearly-service' ? copy.annualPriceLabel
                            : copy.clubYearPriceLabel}
                      </div>
                      {product.pricingMode === 'subscription' && !product.allowMonthly && <div className="KitHireMonthlyLabel">Paid up front to 1 March</div>}
                      {product.type === 'voucher' && <div className="KitHireMonthlyLabel">Spend on: {scopeLabel(voucherScope(product), (id) => products.find((candidate) => candidate.id === id)?.name || id).replace(/^Everything/, 'everything')}</div>}
                    </>
                  )}
                </div>
                {product.type === 'external' ? (
                  <a href={product.externalLink} target="_blank" rel="noreferrer" className="PrimaryActionButton">
                    {copy.externalAction} <ExternalLink className="IconSm" />
                  </a>
                ) : closed ? <span className="shop_product_meta">Bookings closed</span> : purchaseControl(product, () => addToCart(product, size), size)}
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
