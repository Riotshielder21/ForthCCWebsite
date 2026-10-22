import React, { useState } from 'react';
import { ShoppingCart, Plus, Minus, ExternalLink, ChevronDown, Pencil } from 'lucide-react';
import { DISCOUNTS, CATEGORIES } from '../constants/products';
import { usePageContent, usePageEditor } from '../utils/PageContentContext';
import { eventScheduleLabel } from '../utils/catalogue';
import { isTripEvent } from '../utils/tripDiscount';
import { productLimits } from '../utils/inventory';

export default function MembershipPage({ activeCategory, setActiveCategory, cart, availability = {}, stockLeft = () => Infinity, addToCart, removeOneFromCart, getItemDisplayPrice, getKitHireMonthly, products, onNavigate }) {
  const copy = usePageContent('membership');
  const { adminUser } = usePageEditor();
  const [selectedTier, setSelectedTier] = useState('adult');
  const [tierDropdownOpen, setTierDropdownOpen] = useState(false);
  const [sizeChoice, setSizeChoice] = useState({});

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
          {selectedMembership && (activeCategory === 'ALL' || activeCategory === 'MEMBERSHIP') && (
            <div className="shop_product_tile">
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
          {displayProducts.map((product) => {
            const merchandise = product.category === 'MERCHANDISE';
            const remaining = availability[product.id]?.remaining;
            const sizes = merchandise ? Object.keys(productLimits(product) || {}) : [];
            const inStock = (size) => !remaining || (remaining[size] ?? 0) > 0;
            const size = merchandise ? (sizeChoice[product.id] && inStock(sizeChoice[product.id]) ? sizeChoice[product.id] : sizes.find(inStock) || sizes[0] || '') : '';
            const placesLeft = product.category === 'EVENTS' ? remaining?.all : null;
            return (
            <div key={product.id} className="shop_product_tile">
              {product.imageUrl && <img className="shop_product_image" src={product.imageUrl} alt="" />}
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
                  {product.type === 'yearly-service' ? (
                    <>
                      <div className="shop_product_price">£{product.basePrice.toFixed(2)}</div>
                      <div className="shop_product_meta">{copy.annualPriceLabel}</div>
                      <div className="KitHireMonthlyLabel">
                        or £{getKitHireMonthly(product)} /month
                      </div>
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
                          : product.type === 'annual-oneoff'
                            ? copy.clubYearPriceLabel
                            : copy.monthlyPriceLabel}
                      </div>
                    </>
                  )}
                </div>
                {product.type === 'external' ? (
                  <a href={product.externalLink} target="_blank" rel="noreferrer" className="PrimaryActionButton">
                    {copy.externalAction} <ExternalLink className="IconSm" />
                  </a>
                ) : purchaseControl(product, () => addToCart(product, size), size)}
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
