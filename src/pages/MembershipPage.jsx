import React, { useState } from 'react';
import { ShoppingCart, CheckCircle2, ExternalLink, ChevronDown } from 'lucide-react';
import { DISCOUNTS, CATEGORIES } from '../constants/products';
import { usePageContent } from '../utils/PageContentContext';

export default function MembershipPage({ activeCategory, setActiveCategory, cart, addToCart, getItemDisplayPrice, getKitHireMonthly, products }) {
  const copy = usePageContent('membership');
  const [selectedTier, setSelectedTier] = useState('adult');
  const [tierDropdownOpen, setTierDropdownOpen] = useState(false);

  const membershipTiers = products.filter((product) => product.membershipTier);
  const nonMembershipProducts = products.filter((product) => !product.membershipTier);
  const selectedMembership = membershipTiers.find(t => t.membershipTier === selectedTier);
  const membershipInCart = membershipTiers.some(t => cart.find(i => i.id === t.id));

  const handleAddMembership = () => {
    if (!selectedMembership || membershipInCart) return;
    addToCart(selectedMembership);
  };

  const displayProducts = nonMembershipProducts.filter(
    (p) => activeCategory === 'ALL' || p.category === activeCategory
  );

  return (
    <div className="PageFadeIn">
      <div className="SectionHero">
        <div className="PageHero">
          <div>
            <h2 className="PageTitle">{copy.title}</h2>
            <p className="PageIntro">{copy.intro}</p>
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
                <span className="ShopItemEyebrow">{copy.memberEyebrow}</span>
                <h3 className="ShopItemTitle">{copy.memberTitle}</h3>
              </div>
              <p className="ShopItemBody">{copy.memberBody}</p>

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

              <div className="ShopItemFooter">
                <div>
                  <div className="ShopItemPrice">£{selectedMembership?.basePrice.toFixed(2)}</div>
                  <div className="ShopItemMeta">{copy.clubYearPriceLabel}</div>
                </div>
                <button
                  onClick={handleAddMembership}
                  className={`${membershipInCart ? 'IconActionButton IconActionButtonActive' : 'IconActionButton'}`}
                  aria-label={membershipInCart ? `${selectedMembership.name} is in basket` : `Add ${selectedMembership.name} to basket`}
                  title={membershipInCart ? 'Already in basket' : 'Add to basket'}
                >
                  {membershipInCart ? <CheckCircle2 className="IconXl" /> : <ShoppingCart className="IconXl" />}
                </button>
              </div>
            </div>
          )}

          {/* All other products */}
          {displayProducts.map((product) => (
            <div key={product.id} className="ShopItemCard">
              {product.imageUrl && <img className="ShopItemImage" src={product.imageUrl} alt="" />}
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
                      <div className="ShopItemMeta">{copy.annualPriceLabel}</div>
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
                          ? copy.voucherPriceLabel
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
                ) : (
                  <button
                    onClick={() => addToCart(product)}
                    className={`${cart.find((i) => i.id === product.id) ? 'IconActionButton IconActionButtonActive' : 'IconActionButton'}`}
                    aria-label={cart.find((i) => i.id === product.id) ? `${product.name} is in basket` : `Add ${product.name} to basket`}
                    title={cart.find((i) => i.id === product.id) ? 'Already in basket' : 'Add to basket'}
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
