import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Trash2, ShoppingBag, X, ShoppingCart,
  CreditCard, CheckCircle2, AlertCircle
} from 'lucide-react';
import { initializeAuth, validateDiscountCode } from './utils/firebase';
import { calculateCart } from './utils/pricing';
import { eventScheduleLabel } from './utils/catalogue';
import SiteNavigation from './components/SiteNavigation';
import HomePage from './pages/HomePage';
import MembershipPage from './pages/MembershipPage';
import BeginnersPage from './pages/BeginnersPage';
import DisciplinesPage from './pages/DisciplinesPage';
import VolunteeringPage from './pages/VolunteeringPage';
import AboutPage from './pages/AboutPage';
import ContactUsPage from './pages/ContactUsPage';
import AccessProjectPage from './pages/AccessProjectPage';
import AdminPage from './pages/AdminPage';
import AdminReportsPage from './pages/AdminReportsPage';
import OrderLookupPage from './pages/OrderLookupPage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import { loadPublishedPageContent, subscribeToProducts } from './utils/content';
import { PageContentProvider } from './utils/PageContentContext';
import { apiUrl } from './utils/api';
import { PRODUCTS } from './constants/products';
import { PAGE_CONTENT } from './constants/pageContent';
import './index.css';

export default function App() {
  const [currentPage, setCurrentPage] = useState(() => {
    if (window.location.pathname === '/admin/reports') return 'admin-reports';
    if (window.location.pathname === '/admin') return 'admin';
    if (window.location.pathname.startsWith('/order/')) return 'order-lookup';
    if (window.location.pathname === '/payment-success') return 'payment-success';
    const previewPage = window.location.pathname.startsWith('/_preview/')
      ? window.location.pathname.slice('/_preview/'.length)
      : new URLSearchParams(window.location.search).get('page');
    if (previewPage && PAGE_CONTENT[previewPage]) return previewPage === 'contact' ? 'contact-us' : previewPage;
    return 'home';
  });
  const [products, setProducts] = useState(PRODUCTS);
  const [pageContent, setPageContent] = useState({});
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAnnual, setIsAnnual] = useState(true);
  const [activeCategory, setActiveCategory] = useState('ALL');

  const [promoInput, setPromoInput] = useState('');
  const [activePromo, setActivePromo] = useState(null);
  const [promoError, setPromoError] = useState(null);

  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const checkoutEmailRef = useRef(null);

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
  }, []);

  useEffect(() => subscribeToProducts((remoteProducts) => {
    setProducts(remoteProducts);
  }, (error) => console.error('Product catalog unavailable:', error)), []);

  useEffect(() => loadPublishedPageContent(setPageContent, (error) => {
    console.error('Page content unavailable:', error);
  }), []);

  const addToCart = (product) => {
    if (product.type === 'external') return;
    setCart((prev) => {
      if (prev.find((item) => item.id === product.id)) return prev;
      return [...prev, product];
    });
    showToast(`${product.name} added to basket`);
  };

  const removeFromCart = (id) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const handleCheckout = async () => {
    if (!checkoutEmail.trim()) {
      setCheckoutError('Enter an email address to receive your receipt.');
      checkoutEmailRef.current?.focus();
      return;
    }
    if (!checkoutEmailRef.current?.checkValidity()) {
      checkoutEmailRef.current?.reportValidity();
      setCheckoutError('Enter a valid email address to receive your receipt.');
      return;
    }
    setCheckoutError('');
    try {
      const response = await fetch(apiUrl('/api/checkout-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: checkoutEmail.trim(),
          items: cart.map((item) => ({ id: item.id })),
          discountCode: activePromo?.code || '',
          billingMode: isAnnual ? 'annual' : 'monthly'
        })
      });
      const order = await response.json();
      if (!response.ok) throw new Error(order.error || 'Could not save your purchase.');
      window.location.href = order.checkoutUrl;
      return;
    } catch (error) {
      setCheckoutError(error.message);
      return;
    }
    setIsCartOpen(false);
  };

  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();

    try {
      const validation = await validateDiscountCode(code);
      if (validation.valid) {
        setActivePromo({
          label: validation.label,
          discountType: validation.discountType,
          discountValue: validation.discountValue,
          allowsAnnualStacking: validation.allowsAnnualStacking === true,
          code
        });
        setPromoError(null);
      } else {
        setActivePromo(null);
        setPromoError(validation.message || 'Invalid code');
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

  const calculations = useMemo(() => calculateCart(cart, isAnnual, activePromo), [cart, isAnnual, activePromo]);

  const getPricedItemDetails = (item) => calculations.items.find((pricedItem) => pricedItem.id === item.id)
    || calculateCart([item], isAnnual).items[0];

  const getItemDisplayPrice = (item) => {
    return getPricedItemDetails(item).displayPrice.toFixed(2);
  };

  const getItemBillingLabel = (item) =>
    getPricedItemDetails(item).label;

  const getKitHireMonthly = (item) => {
    const clubYear = getClubYearContext();
    const months = clubYear.monthsRemaining;
    return (item.basePrice / months).toFixed(2);
  };

  const renderPage = () => {
    if (currentPage === 'order-lookup') return <OrderLookupPage />;
    if (currentPage === 'payment-success') return <PaymentSuccessPage />;

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
            products={products}
          />
        );
      case 'admin':
        return <AdminPage products={products} onNavigate={setCurrentPage} />;
      case 'admin-reports':
        return <AdminReportsPage onNavigate={setCurrentPage} />;
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
    <PageContentProvider value={pageContent}>
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
            <a href="/admin" onClick={(event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              setCurrentPage('admin');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }} className="FooterLink">Admin</a>
          </div>
        </div>
      </footer>

      {isCartOpen && (
        <div className="CartOverlay">
          <div className="CartBackdrop" onClick={() => setIsCartOpen(false)} />
          <div className="CartPanel" style={{ animation: 'slideInFromRight 500ms ease-out' }}>
            <div className="CartHeader">
              <h2 className="CartTitle">Your Basket</h2>
              <button onClick={() => setIsCartOpen(false)} className="CartCloseButton" aria-label="Close basket">
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
                          {item.eventSchedule && <p className="text_container text_container_note">{eventScheduleLabel(item.eventSchedule)}</p>}
                          <span className="CartItemMeta">
                            {getItemBillingLabel(item)}
                          </span>
                        </div>
                        <div className="CartItemActions">
                          <span className="CartItemPrice">£{getItemDisplayPrice(item)}</span>
                          <button
                            onClick={() => removeFromCart(item.id)}
                            className="CartRemoveButton"
                            aria-label={`Remove ${item.name} from basket`}
                          >
                            <Trash2 className="IconMd" />
                          </button>
                        </div>
                      </div>
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
                      {activePromo.discountType !== 'multiplier'
                        ? `${activePromo.label} (${activePromo.code}): -£${calculations.promoDiscountValue.toFixed(2)}`
                        : `${activePromo.label} (${(activePromo.discountValue * 100).toFixed(0)}%): -£${calculations.promoDiscountValue.toFixed(2)}`}
                    </div>
                  )}
                  <div className="CartSummaryTotal">
                    Total £{calculations.total.toFixed(2)}
                  </div>
                  <label className="FormLabel CartEmailLabel">
                    Receipt email
                    <input
                      ref={checkoutEmailRef}
                      className="FormInput"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                      inputMode="email"
                      value={checkoutEmail}
                      onChange={(event) => setCheckoutEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  {checkoutError && <p className="StatusText StatusTextError">{checkoutError}</p>}
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
    </PageContentProvider>
  );
}