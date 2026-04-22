import React, { useState } from 'react';
import { ShoppingCart, CheckCircle2, ExternalLink, ChevronDown } from 'lucide-react';
import { DISCOUNTS, CATEGORIES, PRODUCTS } from '../constants/products';

const MEMBERSHIP_TIERS = PRODUCTS.filter(p => p.membershipTier);
const NON_MEMBERSHIP_PRODUCTS = PRODUCTS.filter(p => !p.membershipTier);

export default function MembershipPage({ activeCategory, setActiveCategory, cart, addToCart, getItemDisplayPrice, getKitHireMonthly }) {
  const [selectedTier, setSelectedTier] = useState('adult');
  const [tierDropdownOpen, setTierDropdownOpen] = useState(false);

  const selectedMembership = MEMBERSHIP_TIERS.find(t => t.membershipTier === selectedTier);
  const membershipInCart = MEMBERSHIP_TIERS.some(t => cart.find(i => i.id === t.id));

  const handleAddMembership = () => {
    if (!selectedMembership || membershipInCart) return;
    addToCart(selectedMembership);
  };

  const displayProducts = NON_MEMBERSHIP_PRODUCTS.filter(
    (p) => activeCategory === 'ALL' || p.category === activeCategory
  );

  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="PageHero">
          <div>
            <h2 className="PageTitle">Store &<br />Subscriptions</h2>
            <p className="PageIntro">The club year runs from 1 March. Membership and annual kit hire cover the current club year, while annual subscriptions are prorated to the next 1 March renewal.</p>
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
        <div className="ShopGrid">
          {/* Membership tier card */}
          {(activeCategory === 'ALL' || activeCategory === 'MEMBERSHIP') && (
            <div className="ShopItemCard">
              <div className="ShopItemHeader">
                <span className="ShopItemEyebrow">MEMBERSHIP</span>
                <h3 className="ShopItemTitle">Club Membership<br />Via Website</h3>
              </div>
              <p className="ShopItemBody">
                Join directly through our website. We'll set up your JustGo & SCA membership for you.
                Select your tier below.
              </p>

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
                    {MEMBERSHIP_TIERS.map((tier) => (
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

              <div className="ShopItemFooter">
                <div>
                  <div className="ShopItemPrice">£{selectedMembership?.basePrice.toFixed(2)}</div>
                  <div className="ShopItemMeta">Club Year Price</div>
                </div>
                <button
                  onClick={handleAddMembership}
                  className={`${membershipInCart ? 'IconActionButton IconActionButtonActive' : 'IconActionButton'}`}
                >
                  {membershipInCart ? <CheckCircle2 className="IconXl" /> : <ShoppingCart className="IconXl" />}
                </button>
              </div>
            </div>
          )}

          {/* All other products */}
          {displayProducts.map((product) => (
            <div key={product.id} className="ShopItemCard">
              {product.hasAnnualDiscount && (
                <div className="ShopItemBadge">
                  Save {(DISCOUNTS.ANNUAL * 100).toFixed(0)}% Annually
                </div>
              )}
              <div className="ShopItemHeader">
                <span className="ShopItemEyebrow">{product.category}</span>
                <h3 className="ShopItemTitle">{product.name}</h3>
              </div>
              <p className="ShopItemBody">{product.description}</p>
              <div className="ShopItemFooter">
                <div>
                  {product.type === 'yearly-service' ? (
                    <>
                      <div className="ShopItemPrice">£{product.basePrice.toFixed(2)}</div>
                      <div className="ShopItemMeta">Annual Price</div>
                      <div className="KitHireMonthlyLabel">
                        or £{getKitHireMonthly(product)} /month
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="ShopItemPrice">
                        {product.priceLabel || `£${product.basePrice.toFixed(2)}`}
                      </div>
                      <div className="ShopItemMeta">
                        {product.type === 'voucher'
                          ? 'Gift Voucher'
                          : product.type === 'annual-oneoff'
                            ? 'Club Year Price'
                            : 'Monthly Price'}
                      </div>
                    </>
                  )}
                </div>
                {product.type === 'external' ? (
                  <a href={product.externalLink} target="_blank" rel="noreferrer" className="PrimaryActionButton">
                    JustGo <ExternalLink className="IconSm" />
                  </a>
                ) : (
                  <button
                    onClick={() => addToCart(product)}
                    className={`${cart.find((i) => i.id === product.id) ? 'IconActionButton IconActionButtonActive' : 'IconActionButton'}`}
                  >
                    {cart.find((i) => i.id === product.id) ? <CheckCircle2 className="IconXl" /> : <ShoppingCart className="IconXl" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
