import React, { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react';
import {
  Trash2, ShoppingBag, X, ShoppingCart, Plus, Minus,
  CreditCard, CheckCircle2, AlertCircle
} from 'lucide-react';
import { calculateCart, debitRange, expandClubYearLines, expandPeopleLines } from './utils/pricing';
import { clubYearChoices, defaultClubYearChoice, resolveClubYearChoice, clubYearOf, clubYearLabel } from './utils/clubYear';
import { assignLines, validateCheckout, loadDraft, saveDraft, clearDraft, blankPerson, normaliseName, returningVerificationMatches, restoreDraftLines } from './utils/checkout';
import { applyTripDiscounts } from './utils/tripDiscount';
import { applyConsentPrefill, checkoutWording, draftForCurrentWording } from './utils/consents';
import { eventScheduleLabel, normaliseProduct } from './utils/catalogue';
import { itemLabel, productLimits } from './utils/inventory';
import SiteNavigation from './components/SiteNavigation';
import { pageModules } from './pages/pageModules';
import { useSiteRoute } from './utils/useSiteRoute';
import PageLoadBoundary from './components/PageLoadBoundary';
import OfflineStatus from './components/OfflineStatus';
import AnalyticsConsentBanner from './components/AnalyticsConsentBanner';
import { loadPublishedPageContent } from './utils/publicContent';
import { subscribeToProducts } from './utils/content';
import { validateDiscountCode } from './utils/discountCodeApi';
import { PageContentProvider } from './utils/PageContentContext';
import { apiUrl, apiFetch } from './utils/api';
import { PRODUCTS } from './constants/products';
import './index.css';
import fccCrest from './assets/fcc-crest.png';
import { applyVolunteerBenefits } from './utils/volunteering';
import { readPublicSnapshot, savePublicSnapshot } from './utils/publicSnapshots';

const HomePage = lazy(pageModules.home);
const MembershipPage = lazy(pageModules.membership);
const BeginnersPage = lazy(pageModules.beginners);
const DisciplinesPage = lazy(pageModules.disciplines);
const VolunteeringPage = lazy(pageModules.volunteering);
const AboutPage = lazy(pageModules.about);
const ContactUsPage = lazy(pageModules['contact-us']);
const SafeguardingPage = lazy(pageModules.safeguarding);
const NoticesPage = lazy(pageModules.notices);
const AccessProjectPage = lazy(pageModules['access-project']);
const AdminPage = lazy(pageModules.admin);
const AdminReportsPage = lazy(pageModules['admin-reports']);
const ClubNightPage = lazy(pageModules['club-night']);
const MyDetailsPage = lazy(pageModules['my-details']);
const CheckoutPage = lazy(pageModules.checkout);
const OrderLookupPage = lazy(pageModules['order-lookup']);
const PaymentSuccessPage = lazy(pageModules['payment-success']);
const PaymentIssuePage = lazy(pageModules['payment-issue']);

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Club-year items carry which club year they are for; a choice no longer on sale falls back to the default.
const withClubYear = (product, choice) => {
  const resolved = resolveClubYearChoice(product, choice) || defaultClubYearChoice(product);
  const { clubYearChoice: _previous, ...rest } = product;
  return resolved ? { ...rest, clubYearChoice: resolved } : rest;
};
const draftLine = (product, line) => ({ ...withClubYear(normaliseProduct(product), line.clubYearChoice), lineId: line.lineId, ...(line.size ? { size: line.size } : {}) });
const groupKey = (line) => `${line.id}|${line.size || ''}|${line.clubYearChoice || ''}`;
const choiceLabel = (choice) => {
  const year = clubYearOf(new Date());
  return choice === 'this' ? `This club year (${clubYearLabel(year)})`
    : choice === 'next' ? `Next club year (${clubYearLabel(year + 1)})`
    : `Both (${clubYearLabel(year)} and ${clubYearLabel(year + 1)})`;
};

const BASKET_LINKS = [
  { param: 'renew', path: (token) => `/api/renewals/${token}`, failure: 'Could not load your renewal. Add your membership to the basket instead.' },
  { param: 'retry', path: (key) => `/api/orders/${key}/retry`, resumes: 'retryOf', failure: 'Could not load your order. Add what you need to the basket instead.' },
  { param: 'restart', path: (key) => `/api/subscriptions/${key}/restart`, resumes: 'restartOf', failure: 'Could not load your monthly payments. Add what you need to the basket instead.' }
];

export default function App() {
  const [initialDraft] = useState(() => draftForCurrentWording(loadDraft()));
  const { currentPage, setCurrentPage, onLinkClick, navigateTo } = useSiteRoute();
  const [products, setProducts] = useState(() => readPublicSnapshot('products') || PRODUCTS);
  const [availability, setAvailability] = useState({});
  const productsRef = useRef(products);
  productsRef.current = products;
  const [pageContent, setPageContent] = useState({});
  const [restoredCart] = useState(() => restoreDraftLines(initialDraft?.cart, products, draftLine));
  const [cart, setCart] = useState(restoredCart.lines);
  // Saved lines the cached catalogue lacks (such as a new event) wait for the live catalogue rather than being dropped,
  // and until then the attendees and draft are left as they are.
  const waitingDraft = useRef(restoredCart.complete ? null : initialDraft.cart.filter((line) => line?.id));
  const [catalogueLive, setCatalogueLive] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  useEffect(() => {
    if (!isCartOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isCartOpen]);
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
  const pageBeforeCheckout = useRef('/membership');
  const [people, setPeople] = useState(initialDraft?.people || []);
  const [volunteerTiers, setVolunteerTiers] = useState([]);
  const [tripDiscounts, setTripDiscounts] = useState(null);
  const [checkoutErrors, setCheckoutErrors] = useState([]);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  // The failed order or stopped subscription this basket pays for again, from an emailed link.
  const [resumeLink, setResumeLink] = useState(initialDraft?.resumeLink || null);

  const [toast, setToast] = useState(null);
  const [analyticsSettingsOpen, setAnalyticsSettingsOpen] = useState(false);
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => loadPublishedPageContent((content) => setPageContent((current) => ({ ...current, ...content })), (error) => {
    console.error('Page content unavailable:', error);
  }, currentPage), [currentPage]);

  // Admins see their own product saves straight away; public visitors use the availability response below.
  const adminPage = currentPage === 'admin' || currentPage === 'admin-reports';
  useEffect(() => adminPage ? subscribeToProducts((remoteProducts) => {
    setProducts(remoteProducts);
    setCatalogueLive(true);
  }, (error) => console.error('Product catalog unavailable:', error)) : undefined, [adminPage]);

  const refreshAvailability = () => apiFetch(apiUrl('/api/availability'), { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((result) => {
      if (result?.availability) setAvailability(result.availability);
      if (Array.isArray(result?.products)) {
        setProducts(result.products);
        setCatalogueLive(true);
        savePublicSnapshot('products', result.products);
      }
    })
    .catch(() => {});
  useEffect(() => { refreshAvailability(); }, [currentPage, isCartOpen]);

  // How many more of a product (and size) can be added; unlimited products return Infinity.
  const stockLeft = (product, size = '') => {
    const remaining = availability[product.id]?.remaining;
    if (!remaining) return Infinity;
    const inBasket = cart.filter((line) => line.id === product.id && (line.size || '') === size).length;
    return Math.max(0, (remaining[product.category === 'MERCHANDISE' ? size : 'all'] ?? 0) - inBasket);
  };

  const addToCart = (product, size = '', clubYearChoice = undefined) => {
    if (product.type === 'external') return;
    const label = itemLabel({ ...product, size });
    if (stockLeft(product, size) <= 0) {
      showToast(`${label} is sold out`);
      return;
    }
    setCart((prev) => [...prev, { ...withClubYear(product, clubYearChoice), lineId: newId(), ...(size ? { size } : {}) }]);
    showToast(`${label} added to basket`);
  };

  // Identical items are interchangeable, so reducing always takes the most recently added one and its form goes with it.
  const removeOneFromCart = (selection) => {
    setCart((prev) => {
      const matches = typeof selection === 'string'
        ? (line) => groupKey(line) === selection
        : (line) => line.id === selection.id
          && (line.size || '') === (selection.size || '')
          && (!selection.clubYearChoice || line.clubYearChoice === selection.clubYearChoice);
      const index = prev.map((line) => matches(line) ? 1 : 0).lastIndexOf(1);
      return index < 0 ? prev : prev.filter((_, position) => position !== index);
    });
  };

  // Refresh basket lines when the live catalogue loads; unavailable products and withdrawn sizes drop out.
  useEffect(() => {
    const waiting = waitingDraft.current;
    if (waiting && !catalogueLive) return;
    waitingDraft.current = null;
    setCart((prev) => (waiting ? [...waiting, ...prev.filter((line) => !waiting.some((saved) => saved.lineId === line.lineId))] : prev)
      .map((line) => {
        const product = products.find((candidate) => candidate.id === line.id);
        if (!product || (product.category === 'MERCHANDISE' && !Object.hasOwn(productLimits(product) || {}, line.size))) return null;
        return { ...withClubYear(product, line.clubYearChoice), lineId: line.lineId, ...(line.size ? { size: line.size } : {}) };
      })
      .filter(Boolean));
  }, [products, catalogueLive]);

  // Emailed links replace the basket and then leave the address bar: a renewal (?renew=TOKEN) with next year's items, a
  // retry of a bank payment that did not clear (?retry=KEY) and a restart of monthly payments Stripe stopped (?restart=KEY).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const link = BASKET_LINKS.find(({ param }) => params.get(param));
    if (!link) return;
    const value = params.get(link.param);
    params.delete(link.param);
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    setCurrentPage((page) => (page === 'home' ? 'membership' : page));
    apiFetch(apiUrl(link.path(encodeURIComponent(value))), { cache: 'no-store' })
      .then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => null) }))
      .then(({ ok, result }) => {
        if (!ok || !result) throw new Error(result?.error || link.failure);
        const lines = result.items.map((item) => {
          const product = productsRef.current.find((candidate) => candidate.id === item.id);
          return product ? { ...withClubYear(normaliseProduct(product), item.clubYearChoice), lineId: item.lineId, ...(item.size ? { size: item.size } : {}) } : null;
        }).filter(Boolean);
        waitingDraft.current = null;
        setCart(lines);
        setPeople(result.people.map((person) => applyConsentPrefill({ ...blankPerson(person.id), ...person, ...(person.returning ? { verifiedDob: person.dob,
          verifiedEmail: result.email.trim().toLowerCase(), verifiedName: normaliseName(`${person.firstName} ${person.lastName}`) } : {}) }, person.prefill)));
        setCheckoutEmail(result.email);
        setIsAnnual(result.billingMode !== 'monthly');
        setResumeLink(link.resumes ? { [link.resumes]: value } : null);
        if (result.discountCode) {
          setPromoInput(result.discountCode);
          handleApplyPromo(result.discountCode);
        }
        setCheckoutError('');
      })
      .catch((error) => setCheckoutError(error.message))
      .finally(() => setIsCartOpen(true));
  }, [currentPage]);

  useEffect(() => { if (!waitingDraft.current) setPeople((prev) => assignLines(prev, cart, newId)); }, [cart]);
  useEffect(() => { if (!cart.length && !waitingDraft.current) setResumeLink(null); }, [cart.length]);
  // A checkout refusal (e.g. "needs a membership") describes the basket it was given, so it goes once the basket changes.
  const cartKey = cart.map((line) => line.lineId).join('|');
  const refusedCartKey = useRef(cartKey);
  useEffect(() => {
    if (refusedCartKey.current !== cartKey) setCheckoutError('');
  }, [cartKey]);

  // The draft lives in this tab's sessionStorage only, so a customer can return to add a membership.
  useEffect(() => {
    if (currentPage === 'payment-success') {
      waitingDraft.current = null;
      clearDraft();
      setCart([]);
      setPeople([]);
      setCheckoutEmail('');
      setResumeLink(null);
      return;
    }
    if (waitingDraft.current) return;
    if (!cart.length && !people.length && !checkoutEmail) clearDraft();
    else saveDraft({ email: checkoutEmail, people, cart: cart.map(({ id, lineId, size, clubYearChoice }) => ({ id, lineId, ...(size ? { size } : {}), ...(clubYearChoice ? { clubYearChoice } : {}) })), isAnnual, resumeLink, wording: checkoutWording() });
  }, [currentPage, cart, people, checkoutEmail, isAnnual, resumeLink]);

  const handleStartCheckout = () => {
    setCheckoutError('');
    setCheckoutErrors([]);
    setFocusPersonId(null);
    if (currentPage !== 'checkout') pageBeforeCheckout.current = window.location.pathname + window.location.search + window.location.hash;
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
    navigateTo(pageBeforeCheckout.current);
    setIsCartOpen(true);
  };

  const handlePay = async (noticeVersions = {}) => {
    if (!navigator.onLine) {
      setCheckoutErrors(['You are offline. Reconnect before checking availability and making a payment.']);
      return;
    }
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
      const response = await apiFetch(apiUrl('/api/checkout-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: checkoutEmail.trim(),
          items: cart.map(({ id, lineId, size, clubYearChoice }) => ({ id, lineId, ...(size ? { size } : {}), ...(clubYearChoice ? { clubYearChoice } : {}) })),
          people,
          discountCode: activePromo?.code || '',
          billingMode: annualBilling ? 'annual' : 'monthly',
          ...(resumeLink || {}),
          noticeVersions,
          wording: checkoutWording()
        })
      });
      const order = await response.json();
      if (!response.ok) {
        if (['membership_required', 'renews_via_justgo', 'membership_active', 'renewal_unconfirmed', 'sold_out', 'club_year_unavailable', 'already_held', 'payment_processing', 'already_paid'].includes(order.code)) {
          refusedCartKey.current = cartKey;
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

  const handleApplyPromo = async (value = promoInput) => {
    const code = String(value).trim().toUpperCase();

    try {
      const validation = await validateDiscountCode(code);
      if (validation.valid) {
        setActivePromo({
          label: validation.label,
          type: validation.type,
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

  // A line for both club years is priced as this year's line plus next year's.
  useEffect(() => {
    apiFetch(apiUrl('/api/volunteer-benefits')).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load volunteer pricing.');
      setVolunteerTiers(result.tiers);
    }).catch((error) => setCheckoutError(error.message));
    apiFetch(apiUrl('/api/trip-discounts')).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load trip discounts.');
      setTripDiscounts(result.rules);
    }).catch((error) => setCheckoutError(error.message));
  }, []);
  const calculations = useMemo(() => {
    const expanded = expandClubYearLines(cart);
    const holders = expandPeopleLines(people, cart).map((person) => ({ ...person, membershipId: person.id }));
    const records = new Map(people.filter((person) => person.volunteerPreview
      && ['firstName', 'lastName', 'dob'].every((key) => person[key] === person.volunteerPreview[key]))
      .map((person) => [person.id, person.volunteerPreview]));
    // Trip discounts as the server applies them, from this basket and what verified members already hold this club year.
    const year = clubYearOf(new Date());
    const held = new Map(people.filter((person) => person.returning && person.tripHeld?.length && returningVerificationMatches(person, checkoutEmail))
      .map((person) => [person.id, person.tripHeld.map((productId) => ({ productId, clubYear: year }))]));
    return calculateCart(applyTripDiscounts(applyVolunteerBenefits(expanded, holders, records, volunteerTiers), holders, held, new Date(), tripDiscounts || []),
      annualBilling, activePromo);
  }, [cart, annualBilling, activePromo, people, volunteerTiers, tripDiscounts, checkoutEmail]);

  const cartGroups = useMemo(() => {
    const groups = new Map();
    for (const line of cart) {
      const key = groupKey(line);
      if (groups.has(key)) groups.get(key).lines.push(line);
      else groups.set(key, { key, item: line, lines: [line] });
    }
    return [...groups.values()];
  }, [cart]);

  const removeAllFromCart = (key) => setCart((prev) => prev.filter((line) => groupKey(line) !== key));
  const setGroupClubYear = (key, choice) => setCart((prev) => prev.map((line) => groupKey(line) === key ? { ...line, clubYearChoice: choice } : line));
  const clearCart = () => {
    if (window.confirm('Remove everything from your basket?')) setCart([]);
  };

  const getPricedItemDetails = (item) => {
    const parts = calculations.items.filter((pricedItem) => pricedItem.sourceLineId === item.lineId);
    const priced = parts.length ? parts : calculateCart(expandClubYearLines([item]), annualBilling).items;
    return { displayPrice: priced.reduce((sum, part) => sum + part.displayPrice, 0), label: priced.map((part) => part.label).join(' + ') };
  };

  const getItemDisplayPrice = (item) => {
    return getPricedItemDetails(item).displayPrice.toFixed(2);
  };

  const getItemBillingLabel = (item) =>
    getPricedItemDetails(item).label;

  const renderPage = () => {
    if (currentPage === 'order-lookup') return <OrderLookupPage />;
    if (currentPage === 'payment-success') return <PaymentSuccessPage />;
    if (currentPage === 'payment-issue') return <PaymentIssuePage />;
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
          pricedItems={calculations.items}
          tripDiscounts={tripDiscounts || []}
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
            tripDiscounts={tripDiscounts || []}
          />
        );
      case 'admin':
        return <AdminPage products={products} onNavigate={setCurrentPage} tripDiscounts={tripDiscounts} />;
      case 'admin-reports':
        return <AdminReportsPage onNavigate={setCurrentPage} />;
      case 'beginners':
        return <BeginnersPage onNavigate={setCurrentPage} products={products} />;
      case 'disciplines':
        return <DisciplinesPage />;
      case 'volunteering':
        return <VolunteeringPage products={products} />;
      case 'club-night':
        return <ClubNightPage />;
      case 'my-details':
        return <MyDetailsPage />;
      case 'about':
        return <AboutPage />;
      case 'contact-us':
        return <ContactUsPage />;
      case 'safeguarding':
        return <SafeguardingPage />;
      case 'notices':
        return <NoticesPage />;
      case 'access-project':
        return <AccessProjectPage />;
      default:
        return <div className="SectionHero">
          <h2 className="page_heading_bold_1">Page not found</h2>
          <p className="text_container">This page may have moved or is not available on the rebuilt website yet.</p>
          <a className="PrimaryActionButtonCompact" href="/">Go to the homepage</a>
          <a className="ContentLink" href="/contact-us">Contact the club</a>
        </div>;
    }
  };

  return (
    <PageContentProvider value={pageContent} enableAdminAuth={currentPage === 'admin' || currentPage === 'admin-reports'}>
    <div className="SiteShell" onClick={onLinkClick}>
      <SiteNavigation
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        cartCount={cart.length}
        onCartOpen={currentPage === 'checkout' ? handleBackToBasket : () => setIsCartOpen(true)}
      />

      <main className="SiteMain">
        <OfflineStatus currentPage={currentPage} />
        <PageLoadBoundary key={currentPage}>
          <Suspense fallback={<div className="SectionContent" role="status">Loading page…</div>}>
            {renderPage()}
          </Suspense>
        </PageLoadBoundary>
      </main>

      <footer className="FooterBar">
        <div className="FooterInner">
          <div className="FooterBrand">
            <img src={fccCrest} alt="" className="FooterCrest" />
            <div>
            <p className="FooterCopyright">© {new Date().getFullYear()} Forth Canoe Club. All Rights Reserved.</p>
            <p className="FooterMeta">Forth Canoe Club is a Registered Scottish Charity (SC050275)</p>
            <p className="FooterMeta SpaceT1">Harrison Park, Polwarth, Edinburgh EH11 1ED</p>
            </div>
          </div>
          <div className="FooterLinks">
            <a href="https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC050275" target="_blank" rel="noreferrer" className="FooterLink">Charity Register</a>
            <a href="/contact-us" className="FooterLink">Contact</a>
            <a href="/safeguarding" className="FooterLink">Safeguarding</a>
            <a href="/notices" className="FooterLink">Notices</a>
            <button type="button" className="FooterLink FooterLinkButton" onClick={() => setAnalyticsSettingsOpen(true)}>Analytics settings</button>
            <a href="/check-ins" onClick={(event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              setCurrentPage('club-night');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }} className="FooterLink">Check-ins</a>
            <a href="/admin" onClick={(event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              setCurrentPage('admin');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }} className="FooterLink">Admin</a>
          </div>
        </div>
      </footer>
      <AnalyticsConsentBanner open={analyticsSettingsOpen} onClose={() => setAnalyticsSettingsOpen(false)} />

      {isCartOpen && (
        <div className="CartOverlay">
          <div className="CartBackdrop" onClick={() => setIsCartOpen(false)} />
          <div className="CartPanel" role="dialog" aria-modal="true" aria-labelledby="basket-title" style={{ animation: 'slideInFromRight 500ms ease-out' }}>
            <div className="CartHeader">
              <h2 className="CartTitle" id="basket-title">Your Basket</h2>
              <button onClick={() => setIsCartOpen(false)} className="CartCloseButton" aria-label="Close basket">
                <X className="IconXl" />
              </button>
            </div>

            <div className="CartControls">
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

              {cart.length > 0 && (
                <button type="button" onClick={clearCart} className="CartClearButton">Clear basket</button>
              )}
            </div>

            <div className="CartBody" tabIndex={0} role="region" aria-label="Basket items">
              <div className="CartItemList">
                {cart.length === 0 ? (
                  <div className="CartEmptyState">
                    <ShoppingBag />
                    <p className="CartEmptyText">Basket is empty</p>
                    {checkoutError && <p className="StatusText StatusTextError" role="alert">{checkoutError}</p>}
                  </div>
                ) : (
                  cartGroups.map(({ key, item, lines }) => (
                    <div key={key} className="CartItemCard">
                      <div className="CartItemRow">
                        <div>
                          <h4 className="CartItemTitle">{itemLabel(item)}</h4>
                          {item.eventSchedule && <p className="text_container text_container_note">{eventScheduleLabel(item.eventSchedule)}</p>}
                          {clubYearChoices(item).length > 1 && (
                            <select value={item.clubYearChoice} onChange={(event) => setGroupClubYear(key, event.target.value)}
                              className="FormInput CartClubYear" aria-label={`Club year for ${itemLabel(item)}`}>
                              {clubYearChoices(item).map((choice) => <option key={choice} value={choice}>{choiceLabel(choice)}</option>)}
                            </select>
                          )}
                          <span className="CartItemMeta">
                            {getItemBillingLabel(item)}
                          </span>
                        </div>
                        <div className="CartItemActions">
                          <span className="CartItemPrice">£{lines.reduce((sum, line) => sum + Number(getItemDisplayPrice(line)), 0).toFixed(2)}</span>
                          <button
                            onClick={() => removeOneFromCart(key)}
                            className="CartRemoveButton"
                            aria-label={`Remove one ${itemLabel(item)}`}
                            title="Remove one"
                          >
                            <Minus className="IconMd" />
                          </button>
                          <span className="CartItemQuantity" aria-label={`${lines.length} in basket`}>{lines.length}</span>
                          <button
                            onClick={() => addToCart(item, item.size || '', item.clubYearChoice)}
                            className="CartRemoveButton"
                            disabled={stockLeft(item, item.size || '') <= 0}
                            aria-label={`Add another ${itemLabel(item)}`}
                            title="Add another"
                          >
                            <Plus className="IconMd" />
                          </button>
                          <button
                            onClick={() => removeAllFromCart(key)}
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
                        onClick={() => handleApplyPromo()}
                        className="PrimaryActionButtonCompact"
                      >
                        Apply
                      </button>
                    </div>
                    {promoError && (
                      <p className="StatusText StatusTextError" role="alert">
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
                    // Monthly mode: what is taken now, then each club year's direct debit (1st of the month, last on 1 February).
                    <div className="CartBreakdown">
                      <div className="CartBreakdownLabel">Cost Breakdown</div>
                      <div className="CartSummaryLine">
                        Due now: £{calculations.year1Total.toFixed(2)}
                      </div>
                      {calculations.monthlySchedule.map((debit) => (
                        <div key={debit.firstDebit.getTime()} className="CartSummaryLine">
                          Then £{debit.monthly.toFixed(2)} a month on the next {debitRange(debit).replace(/^1 payment/, 'payment')} (club year {clubYearLabel(debit.clubYear)})
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {annualBilling && calculations.annualSaving > 0 && (
                    <div className="CartSummaryLine">
                      Annual Saving: -£{calculations.annualSaving.toFixed(2)}
                    </div>
                  )}
                  {activePromo && calculations.promoDiscountValue > 0 && (
                    <div className="CartSummaryLine">
                      {activePromo.type !== 'multiplier'
                        ? `${activePromo.label} (${activePromo.code}): -£${calculations.promoDiscountValue.toFixed(2)}`
                        : `${activePromo.label} (${(activePromo.discountValue * 100).toFixed(0)}%): -£${calculations.promoDiscountValue.toFixed(2)}`}
                    </div>
                  )}
                  <div className="CartSummaryTotal">
                    Total £{calculations.total.toFixed(2)}
                  </div>
                  {checkoutError && <p className="StatusText StatusTextError" role="alert">{checkoutError}</p>}
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