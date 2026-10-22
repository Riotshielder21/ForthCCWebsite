import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Trash2, ShoppingBag, X, ShoppingCart, Plus, Minus,
  CreditCard, CheckCircle2, AlertCircle
} from 'lucide-react';
import { initializeAuth, validateDiscountCode } from './utils/firebase';
import { calculateCart } from './utils/pricing';
import { assignLines, validateCheckout, loadDraft, saveDraft, clearDraft } from './utils/checkout';
import CheckoutPage from './pages/CheckoutPage';
import { eventScheduleLabel, normaliseProduct } from './utils/catalogue';
import { itemLabel, productLimits } from './utils/inventory';
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

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function App() {
  const [initialDraft] = useState(loadDraft);
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
  const [availability, setAvailability] = useState({});
  const [pageContent, setPageContent] = useState({});
  const [cart, setCart] = useState(() => (initialDraft?.cart || [])
    .map((line) => { const product = PRODUCTS.find((candidate) => candidate.id === line.id); return product ? { ...normaliseProduct(product), lineId: line.lineId } : null; })
    .filter(Boolean));
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isAnnual, setIsAnnual] = useState(initialDraft?.isAnnual ?? true);
  // Monthly billing is only offered when something in the basket allows it.
  const monthlyAvailable = cart.some((item) => item.allowMonthly);
  const annualBilling = isAnnual || !monthlyAvailable;
  const [activeCategory, setActiveCategory] = useState('ALL');

  const [promoInput, setPromoInput] = useState('');
  const [activePromo, setActivePromo] = useState(null);
  const [promoError, setPromoError] = useState(null);

  const [checkoutEmail, setCheckoutEmail] = useState(initialDraft?.email || '');
  const [checkoutError, setCheckoutError] = useState('');
  const [focusPersonId, setFocusPersonId] = useState(null);
  const pageBeforeCheckout = useRef('membership');
  const [people, setPeople] = useState(initialDraft?.people || []);
  const [checkoutErrors, setCheckoutErrors] = useState([]);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

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

  const refreshAvailability = () => fetch(apiUrl('/api/availability'), { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((result) => { if (result?.availability) setAvailability(result.availability); })
    .catch(() => {});
  useEffect(() => { refreshAvailability(); }, [currentPage, isCartOpen]);

  // How many more of a product (and size) can be added; unlimited products return Infinity.
  const stockLeft = (product, size = '') => {
    const remaining = availability[product.id]?.remaining;
    if (!remaining) return Infinity;
    const inBasket = cart.filter((line) => line.id === product.id && (line.size || '') === size).length;
    return Math.max(0, (remaining[product.category === 'MERCHANDISE' ? size : 'all'] ?? 0) - inBasket);
  };

  const addToCart = (product, size = '') => {
    if (product.type === 'external') return;
    const label = itemLabel({ ...product, size });
    if (stockLeft(product, size) <= 0) {
      showToast(`${label} is sold out`);
      return;
    }
    setCart((prev) => [...prev, { ...product, lineId: newId(), ...(size ? { size } : {}) }]);
    showToast(`${label} added to basket`);
  };

  // Identical items are interchangeable, so reducing always takes the most recently added one and its form goes with it.
  const removeOneFromCart = (productId, size = '') => {
    setCart((prev) => {
      const index = prev.map((item) => `${item.id}|${item.size || ''}`).lastIndexOf(`${productId}|${size}`);
      return index < 0 ? prev : prev.filter((_, position) => position !== index);
    });
  };

  // Refresh basket lines when the live catalogue loads; unavailable products and withdrawn sizes drop out.
  useEffect(() => {
    setCart((prev) => prev
      .map((line) => {
        const product = products.find((candidate) => candidate.id === line.id);
        if (!product || (product.category === 'MERCHANDISE' && !Object.hasOwn(productLimits(product) || {}, line.size))) return null;
        return { ...product, lineId: line.lineId, ...(line.size ? { size: line.size } : {}) };
      })
      .filter(Boolean));
  }, [products]);

  useEffect(() => { setPeople((prev) => assignLines(prev, cart, newId)); }, [cart]);

  // The draft lives in this tab's sessionStorage only, so a customer can return to add a membership.
  useEffect(() => {
    if (currentPage === 'payment-success') {
      clearDraft();
      setCart([]);
      setPeople([]);
      setCheckoutEmail('');
      return;
    }
    if (!cart.length && !people.length && !checkoutEmail) clearDraft();
    else saveDraft({ email: checkoutEmail, people, cart: cart.map(({ id, lineId, size }) => ({ id, lineId, ...(size ? { size } : {}) })), isAnnual });
  }, [currentPage, cart, people, checkoutEmail, isAnnual]);

  const handleStartCheckout = () => {
    setCheckoutError('');
    setCheckoutErrors([]);
    setFocusPersonId(null);
    if (currentPage !== 'checkout') pageBeforeCheckout.current = currentPage;
    setIsCartOpen(false);
    setCurrentPage('checkout');
  };

  // Hard refresh keeps tab storage, so this is the explicit way to wipe the typed details (the basket stays).
  const handleResetDetails = () => {
    if (!window.confirm('Clear all the details you have typed for this checkout?')) return;
    clearDraft();
    setCheckoutEmail('');
    setCheckoutErrors([]);
    setPeople(assignLines([], cart, newId));
  };

  const handleBackToBasket = () => {
    setCheckoutErrors([]);
    setCurrentPage(pageBeforeCheckout.current);
    setIsCartOpen(true);
  };

  const handlePay = async () => {
    const errors = [
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checkoutEmail.trim()) ? [] : ['Enter a valid email address to receive your receipt.']),
      ...validateCheckout({ lines: cart, people })
    ];
    if (errors.length) {
      setCheckoutErrors(errors);
      return;
    }
    setCheckoutErrors([]);
    setCheckoutBusy(true);
    try {
      const response = await fetch(apiUrl('/api/checkout-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: checkoutEmail.trim(),
          items: cart.map(({ id, lineId }) => ({ id, lineId })),
          people,
          discountCode: activePromo?.code || '',
          billingMode: annualBilling ? 'annual' : 'monthly'
        })
      });
      const order = await response.json();
      if (!response.ok) {
        if (['membership_required', 'renews_via_justgo', 'membership_active', 'renewal_unconfirmed', 'sold_out'].includes(order.code)) {
          setCheckoutError(order.error);
          if (order.code === 'sold_out') refreshAvailability();
          handleBackToBasket();
        } else {
          setFocusPersonId(order.personIds?.[0] || null);
          setCheckoutErrors(order.details || [order.error || 'Could not start payment.']);
        }
        return;
      }
      window.location.href = order.checkoutUrl;
    } catch (error) {
      setCheckoutErrors([error.message]);
    } finally {
      setCheckoutBusy(false);
    }
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
          productIds: validation.productIds || [],
          categories: validation.categories || [],
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

  const calculations = useMemo(() => calculateCart(cart, annualBilling, activePromo), [cart, annualBilling, activePromo]);

  const cartGroups = useMemo(() => {
    const groups = new Map();
    for (const line of cart) {
      const key = `${line.id}|${line.size || ''}`;
      if (groups.has(key)) groups.get(key).lines.push(line);
      else groups.set(key, { key, item: line, lines: [line] });
    }
    return [...groups.values()];
  }, [cart]);

  const removeAllFromCart = (productId, size = '') => setCart((prev) => prev.filter((line) => line.id !== productId || (line.size || '') !== size));
  const clearCart = () => {
    if (window.confirm('Remove everything from your basket?')) setCart([]);
  };

  const getPricedItemDetails = (item) => calculations.items.find((pricedItem) => pricedItem.lineId === item.lineId)
    || calculateCart([item], annualBilling).items[0];

  const getItemDisplayPrice = (item) => {
    return getPricedItemDetails(item).displayPrice.toFixed(2);
  };

  const getItemBillingLabel = (item) =>
    getPricedItemDetails(item).label;

  const renderPage = () => {
    if (currentPage === 'order-lookup') return <OrderLookupPage />;
    if (currentPage === 'payment-success') return <PaymentSuccessPage />;
    if (currentPage === 'checkout') {
      return cart.length ? (
        <CheckoutPage
          lines={cart}
          people={people}
          onPeopleChange={setPeople}
          email={checkoutEmail}
          onEmailChange={setCheckoutEmail}
          serverErrors={checkoutErrors}
          focusPersonId={focusPersonId}
          busy={checkoutBusy}
          total={calculations.total}
          onBack={handleBackToBasket}
          onReset={handleResetDetails}
          onPay={handlePay}
          makeId={newId}
        />
      ) : (
        <div className="SectionHero"><p className="text_container">Your basket is empty.</p><button className="PrimaryActionButtonCompact" onClick={() => setCurrentPage('membership')}>Go to the shop</button></div>
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
            availability={availability}
            stockLeft={stockLeft}
            addToCart={addToCart}
            removeOneFromCart={removeOneFromCart}
            getItemDisplayPrice={getItemDisplayPrice}
            products={products}
            onNavigate={setCurrentPage}
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
        onCartOpen={currentPage === 'checkout' ? handleBackToBasket : () => setIsCartOpen(true)}
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
              {monthlyAvailable && <div className="BillingToggle">
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
              </div>}

              <div className="CartItemList">
                {cart.length > 0 && (
                  <button type="button" onClick={clearCart} className="CartClearButton">Clear basket</button>
                )}
                {cart.length === 0 ? (
                  <div className="CartEmptyState">
                    <ShoppingBag />
                    <p className="CartEmptyText">Basket is empty</p>
                  </div>
                ) : (
                  cartGroups.map(({ key, item, lines }) => (
                    <div key={key} className="CartItemCard">
                      <div className="CartItemRow">
                        <div>
                          <h4 className="CartItemTitle">{itemLabel(item)}</h4>
                          {item.eventSchedule && <p className="text_container text_container_note">{eventScheduleLabel(item.eventSchedule)}</p>}
                          <span className="CartItemMeta">
                            {getItemBillingLabel(item)}
                          </span>
                        </div>
                        <div className="CartItemActions">
                          <span className="CartItemPrice">£{lines.reduce((sum, line) => sum + Number(getItemDisplayPrice(line)), 0).toFixed(2)}</span>
                          <button
                            onClick={() => removeOneFromCart(item.id, item.size || '')}
                            className="CartRemoveButton"
                            aria-label={`Remove one ${itemLabel(item)}`}
                            title="Remove one"
                          >
                            <Minus className="IconMd" />
                          </button>
                          <span className="CartItemQuantity" aria-label={`${lines.length} in basket`}>{lines.length}</span>
                          <button
                            onClick={() => addToCart(item, item.size || '')}
                            className="CartRemoveButton"
                            disabled={stockLeft(item, item.size || '') <= 0}
                            aria-label={`Add another ${itemLabel(item)}`}
                            title="Add another"
                          >
                            <Plus className="IconMd" />
                          </button>
                          <button
                            onClick={() => removeAllFromCart(item.id, item.size || '')}
                            className="CartRemoveButton"
                            aria-label={`Remove all ${itemLabel(item)} from basket`}
                            title="Remove all"
                          >
                            <Trash2 className="IconMd" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {cart.length > 0 && (
              <div className="CartSummary">
                  <div className="CartSummaryInner">
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
                  {/* Cost Breakdown Section */}
                  {annualBilling ? (
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
                  
                  {annualBilling && calculations.annualSaving > 0 && (
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
                  {checkoutError && <p className="StatusText StatusTextError">{checkoutError}</p>}
                </div>
                <button
                  onClick={handleStartCheckout}
                  className="CheckoutButton"
                >
                  <CreditCard className="IconMd" />
                  Checkout
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