import React, { useState, useEffect, useMemo } from 'react';
import {
  Trash2, ShoppingBag, X, ShoppingCart,
  CreditCard, CheckCircle2, AlertCircle
} from 'lucide-react';
import { initializeAuth, setupAuthListener, validateDiscountCode, generateDiscountCode } from './utils/firebase';
import { DISCOUNTS, VALID_PROMO_CODES } from './constants/products';
import SiteNavigation from './components/SiteNavigation';
import HomePage from './pages/HomePage';
import MembershipPage from './pages/MembershipPage';
import BeginnersPage from './pages/BeginnersPage';
import DisciplinesPage from './pages/DisciplinesPage';
import VolunteeringPage from './pages/VolunteeringPage';
import AboutPage from './pages/AboutPage';
import ContactUsPage from './pages/ContactUsPage';
import AccessProjectPage from './pages/AccessProjectPage';
import ReceiptPage from './pages/ReceiptPage';
import './index.css';

export default function App() {
  const [currentPage, setCurrentPage] = useState('home');
  const [user, setUser] = useState(null);
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAnnual, setIsAnnual] = useState(true);
  const [activeCategory, setActiveCategory] = useState('ALL');

  const [promoInput, setPromoInput] = useState('');
  const [activePromo, setActivePromo] = useState(null);
  const [promoError, setPromoError] = useState(null);

  const [voucherCodes, setVoucherCodes] = useState({});
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  const [toast, setToast] = useState(null);
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const initAuth = async () => {
      await initializeAuth();
    };
    initAuth();
    return setupAuthListener(setUser);
  }, []);

  const addToCart = (product) => {
    if (product.type === 'external') return;
    setCart((prev) => {
      if (prev.find((item) => item.id === product.id)) return prev;
      return [...prev, product];
    });
    if (product.type === 'voucher') {
      setVoucherCodes((prev) => ({ ...prev, [product.id]: generateDiscountCode() }));
    }
    showToast(`${product.name} added to basket`);
  };

  const removeFromCart = (id) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
    setVoucherCodes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleCheckout = () => {
    setReceiptData({
      cart: [...cart],
      calculations: { ...calculations },
      voucherCodes: { ...voucherCodes },
      activePromo: activePromo ? { ...activePromo } : null,
      isAnnual,
    });
    setCheckoutDone(true);
    setIsCartOpen(false);
    setCurrentPage('receipt');
  };

  const handleCloseCheckout = () => {
    setCart([]);
    setVoucherCodes({});
    setActivePromo(null);
    setPromoInput('');
    setCheckoutDone(false);
    setReceiptData(null);
    setIsCartOpen(false);
    setCurrentPage('membership');
  };

  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();

    if (VALID_PROMO_CODES[code]) {
      setActivePromo({ ...VALID_PROMO_CODES[code], code });
      setPromoError(null);
      return;
    }

    try {
      const validation = await validateDiscountCode(code);
      if (validation.valid) {
        setActivePromo({
          label: validation.label,
          discountType: validation.discountType,
          discountValue: validation.discountValue,
          allowsAnnualStacking: validation.codeData?.allowsAnnualStacking === true,
          code
        });
        setPromoError(null);
      } else {
        setActivePromo(null);
        setPromoError(validation.reason === 'expired' ? 'Code expired' : 'Invalid Code');
      }
    } catch (error) {
      setActivePromo(null);
      setPromoError('Error validating code');
    }
  };

  const getClubYearContext = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const clubYearStartYear = currentMonth >= 2 ? currentYear : currentYear - 1;
    const clubYearStart = new Date(clubYearStartYear, 2, 1, 0, 0, 0, 0);
    const nextClubYearStart = new Date(clubYearStartYear + 1, 2, 1, 0, 0, 0, 0);
    const monthsRemaining = Math.max(
      1,
      (nextClubYearStart.getFullYear() - now.getFullYear()) * 12 + (nextClubYearStart.getMonth() - now.getMonth())
    );

    return {
      now,
      clubYearStart,
      nextClubYearStart,
      monthsRemaining
    };
  };

  const getPricedItemDetails = (item) => {
    const clubYear = getClubYearContext();

    if (item.type === 'voucher') {
      return {
        label: 'One-off',
        displayPrice: item.basePrice,
        subtotalPrice: item.basePrice,
        annualSaving: 0,
        promoSaving: 0,
        promoEligible: false,
        year1Cost: item.basePrice,
        recurringMonthlyCost: 0,
        clubYear,
        pricingMode: 'voucher-fixed'
      };
    }

    if (item.type === 'annual-oneoff') {
      return {
        label: 'Club Year',
        displayPrice: item.basePrice,
        subtotalPrice: item.basePrice,
        annualSaving: 0,
        promoSaving: 0,
        promoEligible: false,
        year1Cost: item.basePrice,
        recurringMonthlyCost: 0,
        clubYear,
        pricingMode: 'membership-fixed'
      };
    }

    const isFlatPromo = activePromo && activePromo.discountType === 'flat' && item.type === 'subscription';
    const promoAllowsAnnualStacking = !isFlatPromo || activePromo.allowsAnnualStacking === true;
    const promoAdjustedMonthly = isFlatPromo
      ? Math.max(0, item.basePrice - activePromo.discountValue)
      : item.basePrice;
    const promoMonthlySaving = isFlatPromo ? item.basePrice - promoAdjustedMonthly : 0;

    if (item.type === 'yearly-service') {
      const lateSeasonDiscount = clubYear.monthsRemaining <= 4 ? 0.4 : 0;
      const yearlyPrice = item.basePrice * (1 - lateSeasonDiscount);

      return {
        label: 'Club Year',
        displayPrice: yearlyPrice,
        subtotalPrice: yearlyPrice,
        annualSaving: item.basePrice - yearlyPrice,
        promoSaving: 0,
        promoEligible: false,
        year1Cost: yearlyPrice,
        recurringMonthlyCost: 0,
        clubYear,
        pricingMode: lateSeasonDiscount > 0 ? 'club-year-late-discount' : 'club-year-fixed'
      };
    }

    if (item.type === 'subscription') {
      if (isAnnual) {
        const proratedMonths = clubYear.monthsRemaining;
        const proratedBase = promoAdjustedMonthly * proratedMonths;
        const annualRate = item.hasAnnualDiscount ? 1 - DISCOUNTS.ANNUAL : 1;
        const annualPrice = proratedBase * annualRate;
        const annualSaving = item.hasAnnualDiscount ? proratedBase - annualPrice : 0;

        return {
          label: `Until ${clubYear.nextClubYearStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
          displayPrice: promoAllowsAnnualStacking ? annualPrice : proratedBase,
          subtotalPrice: promoAllowsAnnualStacking ? annualPrice : proratedBase,
          annualSaving: promoAllowsAnnualStacking ? annualSaving : 0,
          promoSaving: isFlatPromo ? promoMonthlySaving * proratedMonths : 0,
          promoEligible: true,
          year1Cost: promoAllowsAnnualStacking ? annualPrice : proratedBase,
          recurringMonthlyCost: promoAdjustedMonthly * (item.hasAnnualDiscount ? annualRate : 1),
          clubYear,
          pricingMode: 'subscription-prorated'
        };
      }

      return {
        label: 'Monthly',
        displayPrice: promoAdjustedMonthly,
        subtotalPrice: promoAdjustedMonthly,
        annualSaving: 0,
        promoSaving: promoMonthlySaving,
        promoEligible: true,
        year1Cost: promoAdjustedMonthly,
        recurringMonthlyCost: promoAdjustedMonthly,
        clubYear,
        pricingMode: 'subscription-monthly'
      };
    }

    return {
      label: isAnnual ? 'Annually' : 'Monthly',
      displayPrice: item.basePrice,
      subtotalPrice: item.basePrice,
      annualSaving: 0,
      promoSaving: 0,
      promoEligible: false,
      year1Cost: item.basePrice,
      recurringMonthlyCost: 0,
      clubYear,
      pricingMode: 'default'
    };
  };

  const getItemDisplayPrice = (item) => {
    return getPricedItemDetails(item).displayPrice.toFixed(2);
  };

  const getItemBillingLabel = (item) =>
    getPricedItemDetails(item).label;

  const calculations = useMemo(() => {
    let subtotal = 0;
    let annualSaving = 0;
    let promoDiscountValue = 0;
    let year1Total = 0;
    let recurringMonthlyTotal = 0;
    const hasPromo = activePromo != null;
    const isMultiplier = hasPromo && activePromo.discountType === 'multiplier';

    cart.forEach((item) => {
      const details = getPricedItemDetails(item);
      subtotal += details.subtotalPrice;
      annualSaving += details.annualSaving;
      promoDiscountValue += details.promoSaving;
      year1Total += details.year1Cost;
      recurringMonthlyTotal += details.recurringMonthlyCost;
    });

    if (isMultiplier) {
      promoDiscountValue = subtotal * activePromo.discountValue;
    }

    const total = subtotal - promoDiscountValue;
    const year1TotalAfterPromo = year1Total - (isMultiplier ? year1Total * activePromo.discountValue : promoDiscountValue);
    
    return { subtotal, annualSaving, promoDiscountValue, total, year1Total: year1TotalAfterPromo, recurringMonthlyTotal };
  }, [cart, isAnnual, activePromo]);

  const getKitHireMonthly = (item) => {
    const clubYear = getClubYearContext();
    const months = clubYear.monthsRemaining;
    return (item.basePrice / months).toFixed(2);
  };

  const renderPage = () => {
    if (currentPage === 'receipt' && receiptData) {
      return (
        <ReceiptPage
          cart={receiptData.cart}
          calculations={receiptData.calculations}
          voucherCodes={receiptData.voucherCodes}
          activePromo={receiptData.activePromo}
          isAnnual={receiptData.isAnnual}
          getPricedItemDetails={getPricedItemDetails}
          onClose={handleCloseCheckout}
        />
      );
    }

    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={setCurrentPage} />;
      case 'membership':
        return (
          <MembershipPage
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            cart={cart}
            addToCart={addToCart}
            getItemDisplayPrice={getItemDisplayPrice}
            getKitHireMonthly={getKitHireMonthly}
          />
        );
      case 'beginners':
        return <BeginnersPage onNavigate={setCurrentPage} />;
      case 'disciplines':
        return <DisciplinesPage />;
      case 'volunteering':
        return <VolunteeringPage />;
      case 'about':
        return <AboutPage />;
      case 'contact-us':
        return <ContactUsPage />;
      case 'access-project':
        return <AccessProjectPage />;
      default:
        return <HomePage onNavigate={setCurrentPage} />;
    }
  };

  return (
    <div className="SiteShell">
      <SiteNavigation
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        cartCount={cart.length}
        onCartOpen={() => setIsCartOpen(true)}
      />

      <main>
        {renderPage()}
      </main>

      <footer className="FooterBar">
        <div className="FooterInner">
          <div>
            <p className="FooterCopyright">© {new Date().getFullYear()} Forth Canoe Club. All Rights Reserved.</p>
            <p className="FooterMeta">Forth Canoe Club is a Registered Scottish Charity (SC050275)</p>
            <p className="FooterMeta SpaceT1">Harrison Park, Polwarth, Edinburgh EH11 1ED</p>
          </div>
          <div className="FooterLinks">
            <a href="https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC050275" target="_blank" rel="noreferrer" className="FooterLink">Charity Register</a>
            <button onClick={() => setCurrentPage('contact-us')} className="FooterLink">Contact</button>
            <button className="FooterLink">Safeguarding</button>
          </div>
        </div>
      </footer>

      {isCartOpen && (
        <div className="CartOverlay">
          <div className="CartBackdrop" onClick={() => setIsCartOpen(false)} />
          <div className="CartPanel" style={{ animation: 'slideInFromRight 500ms ease-out' }}>
            <div className="CartHeader">
              <h2 className="CartTitle">Your Basket</h2>
              <button onClick={() => setIsCartOpen(false)} className="CartCloseButton">
                <X className="IconXl" />
              </button>
            </div>

            <div className="CartBody">
              <div className="BillingToggle">
                <button
                  onClick={() => setIsAnnual(false)}
                  className={`BillingToggleButton ${!isAnnual ? 'BillingToggleButtonActive' : 'BillingToggleButtonIdle'}`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setIsAnnual(true)}
                  className={`BillingToggleButton ${isAnnual ? 'BillingToggleButtonActive' : 'BillingToggleButtonIdle'}`}
                >
                  Club Year / Annual
                </button>
              </div>

              <div className="CartItemList">
                {cart.length === 0 ? (
                  <div className="CartEmptyState">
                    <ShoppingBag />
                    <p className="CartEmptyText">Basket is empty</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={item.id} className="CartItemCard">
                      <div className="CartItemRow">
                        <div>
                          <h4 className="CartItemTitle">{item.name}</h4>
                          <span className="CartItemMeta">
                            {getItemBillingLabel(item)}
                          </span>
                        </div>
                        <div className="CartItemActions">
                          <span className="CartItemPrice">£{getItemDisplayPrice(item)}</span>
                          <button onClick={() => removeFromCart(item.id)} className="CartRemoveButton">
                            <Trash2 className="IconMd" />
                          </button>
                        </div>
                      </div>
                      {item.type === 'voucher' && voucherCodes[item.id] && (
                        <div className="CartVoucherCard">
                          <p className="CartVoucherLabel">Gift Voucher Code</p>
                          <p className="CartVoucherCode">{voucherCodes[item.id]}</p>
                          <p className="CartVoucherHint">Share this code with the recipient - valid 1 year</p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {cart.length > 0 && (
                <div className="PromoSection">
                  <div className="SpaceY2">
                    <div className="PromoInputRow">
                      <input
                        type="text"
                        value={promoInput}
                        onChange={(e) => setPromoInput(e.target.value)}
                        placeholder="DISCOUNT CODE"
                        className={`FormCodeInput ${promoError ? 'FormCodeInputError' : activePromo ? 'FormCodeInputSuccess' : 'FormCodeInputIdle'}`}
                      />
                      <button
                        onClick={handleApplyPromo}
                        className="PrimaryActionButtonCompact"
                      >
                        Apply
                      </button>
                    </div>
                    {promoError && (
                      <p className="StatusText StatusTextError">
                        <AlertCircle className="IconSm" /> {promoError}
                      </p>
                    )}
                    {activePromo && (
                      <p className="StatusText StatusTextSuccess">
                        <CheckCircle2 className="IconSm" /> Promo Applied: {activePromo.label}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="CartSummary">
                <div className="CartSummaryInner">
                  {/* Cost Breakdown Section */}
                  {isAnnual ? (
                    // Annual mode: Only show Year 1 upfront cost
                    <div className="CartBreakdown">
                      <div className="CartBreakdownLabel">Your Cost</div>
                      <div className="CartSummaryLine">
                        Total: £{calculations.year1Total.toFixed(2)}
                      </div>
                    </div>
                  ) : (
                    // Monthly mode: Show Month 1 upfront and monthly recurring
                    <div className="CartBreakdown">
                      <div className="CartBreakdownLabel">Cost Breakdown</div>
                      <div className="CartSummaryLine">
                        1st Month Upfront: £{calculations.year1Total.toFixed(2)}
                      </div>
                      {calculations.recurringMonthlyTotal > 0 && (
                        <div className="CartSummaryLine">
                          Then Monthly: £{calculations.recurringMonthlyTotal.toFixed(2)}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {isAnnual && calculations.annualSaving > 0 && (
                    <div className="CartSummaryLine">
                      Annual Saving: -£{calculations.annualSaving.toFixed(2)}
                    </div>
                  )}
                  {activePromo && calculations.promoDiscountValue > 0 && (
                    <div className="CartSummaryLine">
                      {activePromo.discountType === 'flat'
                        ? `${activePromo.label} (${activePromo.code}): -£${calculations.promoDiscountValue.toFixed(2)}`
                        : `${activePromo.label} (${(activePromo.discountValue * 100).toFixed(0)}%): -£${calculations.promoDiscountValue.toFixed(2)}`}
                    </div>
                  )}
                  <div className="CartSummaryTotal">
                    Total £{calculations.total.toFixed(2)}
                  </div>
                </div>
                <button
                  onClick={handleCheckout}
                  className="CheckoutButton"
                >
                  <CreditCard className="IconMd" />
                  Pay & Get Receipt
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="ToastWrapper">
          <div className="ToastInner">
            <ShoppingCart className="IconMd IconAccent" />
            <span className="ToastText">{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}