import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PatreonMarkIcon } from '../components/icons/PatreonMarkIcon';
import { PageHero } from '../components/layout/PageHero';
import { FooterSection } from '../components/ui/footer-section';
import './checkout/checkout-page.css';

/** Public URLs — set in repo-root `.env` (`VITE_*`, loaded by Vite). Never commit secrets; values are embedded in the JS bundle. */
const SUPPORT_TELEGRAM_URL = String(import.meta.env.VITE_SUPPORT_TELEGRAM_URL || '').trim();
const GIFTCARD_PRODUCT_URL = String(import.meta.env.VITE_GIFTCARD_PRODUCT_URL || '').trim();

/** After opening Patreon, remind returning users where to enter email (see visibility/focus handler). */
const PATREON_RETURN_GUIDE_KEY = 'checkout_expect_patreon_unlock';

const PLANS = {
  basic: {
    label: 'Basic',
    price: '$9.99',
    checkoutUrl: String(import.meta.env.VITE_PATREON_CHECKOUT_BASIC_URL || '').trim(),
  },
  premium: {
    label: 'Premium',
    price: '$24.99',
    checkoutUrl: String(import.meta.env.VITE_PATREON_CHECKOUT_PREMIUM_URL || '').trim(),
  },
};

const METHODS = {
  cashapp: { user: '$shreygg', display: 'Cash App' },
  venmo: { user: 'ieatrocks123', display: 'Venmo' },
  paypal: { user: 'indoshray@gmail.com', display: 'PayPal' },
  zelle: { user: '+1 (571) 326-6602', display: 'Zelle' },
  applepay: { user: '+1 (571) 326-6602', display: 'Apple Pay' },
  giftcard: {
    user: '',
    display: 'Gift Card',
    isGiftCard: true,
    link: GIFTCARD_PRODUCT_URL,
  },
};

/** Same 10 rows for Free | Basic | Premium — cells align horizontally per feature. */
const TIER_COMPARE_ROWS = [
  {
    label: 'Full-length library',
    free: '500+ previews',
    basic: '1,000+ videos',
    premium: '5,000+ videos',
  },
  {
    label: 'OnlyFans leaks vault',
    free: false,
    basic: false,
    premium: true,
  },
  {
    label: 'HD playback (full videos)',
    free: false,
    basic: true,
    premium: true,
  },
  {
    label: 'Ad-free experience',
    free: false,
    basic: true,
    premium: true,
  },
  {
    label: 'Daily new uploads',
    free: false,
    basic: '+10 GB / day',
    premium: '+10 GB + mega vault sync',
  },
  {
    label: 'Banana Girl & niche vaults',
    free: false,
    basic: false,
    premium: true,
  },
  {
    label: 'Custom model videos',
    free: false,
    basic: false,
    premium: true,
  },
  {
    label: 'Exclusive drops & early access',
    free: false,
    basic: false,
    premium: true,
  },
  {
    label: 'Manual upgrade lane',
    free: '—',
    basic: 'Standard',
    premium: 'Fastest',
  },
  {
    label: 'After purchase',
    free: 'Preview only',
    basic: 'Lifetime Tier 1',
    premium: 'Lifetime Tier 2',
  },
];

function CheckoutCompareCell({ value }) {
  if (value === true) {
    return (
      <span className="checkout-matrix-symbol checkout-matrix-symbol--yes" aria-label="Included">
        &#10003;
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="checkout-matrix-symbol checkout-matrix-symbol--no" aria-label="Not included">
        &#10007;
      </span>
    );
  }
  return <span className="checkout-matrix-txt">{value}</span>;
}

function faqItems() {
  return [
    {
      q: 'How long does it take to gain access?',
      a: 'Access is instant! Once your payment is verified, your account is upgraded immediately.',
    },
    {
      q: 'What payment methods do you accept?',
      a: 'We accept Cash App, Venmo, PayPal, Zelle, and Apple Pay.',
    },
    {
      q: 'How do I contact support?',
      a: SUPPORT_TELEGRAM_URL ? (
        <>
          Message us on{' '}
          <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
          .
        </>
      ) : (
        'See the contact link in the site footer.'
      ),
    },
  ];
}

async function fetchJson(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

export function CheckoutPage() {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const [searchParams] = useSearchParams();

  const [userAuthed, setUserAuthed] = useState(null);
  const [patreonEmail, setPatreonEmail] = useState('');
  const [patreonBusy, setPatreonBusy] = useState(false);
  /** `warm`: gold hint after opening Patreon (matches legacy checkout.html) */
  const [patreonMsg, setPatreonMsg] = useState({ text: '', error: false, warm: false });
  /** Pulsing ring + eyebrow when user returns from Patreon (or lands with pending unlock). */
  const [patreonGuideActive, setPatreonGuideActive] = useState(false);
  const patreonCardRef = useRef(null);

  const [faqOpen, setFaqOpen] = useState(null);

  const [payOpen, setPayOpen] = useState(false);
  const [chosenPlan, setChosenPlan] = useState(null);
  const [chosenMethod, setChosenMethod] = useState('');
  const [chosenFile, setChosenFile] = useState(null);
  const [payStep, setPayStep] = useState(1);
  const [gcCode, setGcCode] = useState('');
  const fileInputRef = useRef(null);
  const [processError, setProcessError] = useState(null);

  const [successTier, setSuccessTier] = useState(null);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Get Access Now — Pornwrld';
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setUserAuthed(!!(d && d.authed));
      })
      .catch(() => {
        if (!cancelled) setUserAuthed(false);
      });
    const t = setTimeout(() => {
      if (!cancelled) setUserAuthed((u) => (u === null ? false : u));
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    const ctx = cv.getContext('2d');
    const COLORS = ['170,0,255', '255,60,172', '0,229,255', '0,255,135'];
    const pts = [];
    function resize() {
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();
    for (let i = 0; i < 70; i++) {
      pts.push({
        x: Math.random() * cv.width,
        y: Math.random() * cv.height,
        r: Math.random() * 1.8 + 0.4,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        col: COLORS[Math.floor(Math.random() * COLORS.length)],
        a: Math.random() * 0.45 + 0.1,
      });
    }
    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > cv.width) p.vx *= -1;
        if (p.y < 0 || p.y > cv.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.col},${p.a})`;
        ctx.fill();
        for (let j = i + 1; j < pts.length; j++) {
          const p2 = pts[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 130) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(${p.col},${0.07 * (1 - d / 130)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const dismissPatreonGuide = useCallback(() => {
    setPatreonGuideActive(false);
    try {
      sessionStorage.removeItem(PATREON_RETURN_GUIDE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const activatePatreonGuide = useCallback(() => {
    setPatreonGuideActive(true);
    requestAnimationFrame(() => {
      const el = patreonCardRef.current;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  useEffect(() => {
    let pending = false;
    try {
      pending = sessionStorage.getItem(PATREON_RETURN_GUIDE_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (pending) activatePatreonGuide();
  }, [activatePatreonGuide]);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return;
      try {
        if (sessionStorage.getItem(PATREON_RETURN_GUIDE_KEY) === '1') {
          activatePatreonGuide();
        }
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [activatePatreonGuide]);

  const withQty = useCallback((url, qty) => {
    const n = parseInt(String(qty || ''), 10);
    if (!Number.isFinite(n) || n <= 0) return url;
    try {
      const u = new URL(url, window.location.origin);
      u.searchParams.set('qty', String(n));
      return u.toString();
    } catch {
      return url;
    }
  }, []);

  const redirectToLogin = useCallback((plan) => {
    try {
      sessionStorage.setItem('checkout_return', '/checkout?plan=' + plan);
      sessionStorage.setItem('checkout_pending_plan', plan);
    } catch {
      /* ignore */
    }
    window.location.href =
      '/login?redirect=' + encodeURIComponent('/checkout') + '&plan=' + encodeURIComponent(plan);
  }, []);

  const openScriptCheckout = useCallback((url, qty, existingPopup) => {
    const targetUrl = withQty(url, qty);
    const popup =
      existingPopup && !existingPopup.closed ? existingPopup : window.open('about:blank', '_blank');
    if (popup && !popup.closed) {
      try {
        popup.location.replace(targetUrl);
      } catch {
        popup.location.href = targetUrl;
      }
      return true;
    }
    window.alert('Popup was blocked. Please allow popups for this site and try again.');
    return false;
  }, [withQty]);

  const patreonUnlockSubmit = async (ev) => {
    ev.preventDefault();
    const email = patreonEmail.trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) {
      setPatreonMsg({ text: 'Enter a valid email.', error: true, warm: false });
      return;
    }
    setPatreonBusy(true);
    setPatreonMsg({ text: 'Looking up your membership…', error: false, warm: false });
    try {
      const res = await fetchJson('/api/patreon/redeem', { email });
      if (res.ok && res.data && res.data.success) {
        dismissPatreonGuide();
        setPatreonMsg({
          text: (res.data.message || 'Unlocked!') + ' Reloading…',
          error: false,
          warm: false,
        });
        setTimeout(() => {
          window.location.href = '/?premium=1';
        }, 900);
        return;
      }
      if (res.status === 401) {
        setPatreonMsg({ text: 'Please log in first, then try unlocking again.', error: true, warm: false });
        setTimeout(() => {
          window.location.href = '/login?redirect=' + encodeURIComponent('/checkout');
        }, 1200);
        return;
      }
      if (res.status === 404) {
        setPatreonMsg({
          text: 'No membership found yet. Patreon usually delivers within seconds — checking again…',
          error: true,
          warm: false,
        });
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          const s = await fetchJson('/api/patreon/status', { email });
          if (s.ok && s.data && s.data.found && s.data.tier > 0) {
            clearInterval(poll);
            setPatreonMsg({ text: 'Membership found — unlocking…', error: false, warm: false });
            const r2 = await fetchJson('/api/patreon/redeem', { email });
            if (r2.ok && r2.data && r2.data.success) {
              dismissPatreonGuide();
              setPatreonMsg({ text: 'Unlocked! Reloading…', error: false, warm: false });
              setTimeout(() => {
                window.location.href = '/?premium=1';
              }, 800);
            } else {
              setPatreonMsg({
                text: (r2.data && r2.data.error) || 'Could not unlock — please try again.',
                error: true,
              });
              setPatreonBusy(false);
            }
            return;
          }
          if (attempts >= 10) {
            clearInterval(poll);
            setPatreonMsg({
              text: 'Still nothing. Make sure you used the same email on Patreon, then try again.',
              error: true,
              warm: false,
            });
            setPatreonBusy(false);
          }
        }, 3000);
        return;
      }
      setPatreonMsg({
        text: (res.data && res.data.error) || 'Unable to unlock right now.',
        error: true,
        warm: false,
      });
      setPatreonBusy(false);
    } catch {
      setPatreonMsg({ text: 'Network error — try again.', error: true, warm: false });
      setPatreonBusy(false);
    }
  };

  const doOpenPatreonModal = useCallback(
    (plan) => {
      const p = PLANS[plan];
      if (!p || !p.checkoutUrl) return;
      const qtyParam = searchParams.get('qty');
      const opened = openScriptCheckout(p.checkoutUrl, qtyParam || '', null);
      if (opened) {
        try {
          sessionStorage.removeItem('checkout_pending_plan');
        } catch {
          /* ignore */
        }
        try {
          sessionStorage.setItem(PATREON_RETURN_GUIDE_KEY, '1');
        } catch {
          /* ignore */
        }
        setPatreonMsg({
          text: 'When you’re done on Patreon, come back to this tab — we’ll highlight “Already a Patreon member?” so you can enter your email and unlock.',
          error: false,
          warm: true,
        });
      }
    },
    [openScriptCheckout, searchParams]
  );

  const openCheckout = useCallback(
    (plan) => {
      if (userAuthed === true) {
        doOpenPatreonModal(plan);
        return;
      }
      if (userAuthed === false) redirectToLogin(plan);
    },
    [userAuthed, doOpenPatreonModal, redirectToLogin]
  );

  const closePayModal = useCallback(() => {
    setPayOpen(false);
    setPayStep(1);
    setProcessError(null);
    document.body.style.overflow = '';
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && payOpen) closePayModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [payOpen, closePayModal]);

  const onMethodChange = (e) => {
    const v = e.target.value;
    setChosenMethod(v);
    setChosenFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const detail = chosenMethod ? METHODS[chosenMethod] : null;
  const showGift = detail && detail.isGiftCard;

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setChosenFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      doSubmit(null, file);
    };
    reader.readAsDataURL(file);
  };

  const doSubmit = async (gcCodeArg, fileOverride = null) => {
    const isGC = !!(gcCodeArg && String(gcCodeArg).trim());
    const file = fileOverride || chosenFile;
    if (!isGC && (!file || !chosenPlan || !chosenMethod)) return;
    if (isGC && (!chosenPlan || !chosenMethod)) return;

    setPayStep(2);
    setProcessError(null);

    const fd = new FormData();
    if (isGC) {
      fd.append('giftcard_code', String(gcCodeArg).trim());
    } else {
      fd.append('screenshot', file);
    }
    fd.append('plan', chosenPlan);
    fd.append('method', chosenMethod);

    const fetchPromise = fetch('/api/payment-screenshot', { method: 'POST', body: fd }).then((resp) =>
      resp.json().then((data) => {
        if (!resp.ok) throw new Error(data.error || 'Server error (' + resp.status + ')');
        return data;
      })
    );
    const delayPromise = new Promise((r) => setTimeout(r, 10000));

    try {
      const results = await Promise.all([fetchPromise, delayPromise]);
      const data = results[0];
      if (!data.ok || !data.grantedTier) throw new Error(data.error || 'Tier was not granted');
      closePayModal();
      setSuccessTier(data.grantedTier);
    } catch (err) {
      const msg = err && err.message ? err.message : 'Unknown error';
      console.error('[payment] Error:', msg);
      setProcessError(msg);
      setTimeout(() => setPayStep(1), 4000);
    }
  };

  const giftSubmit = () => {
    const code = gcCode.trim();
    if (!code || !chosenPlan || !chosenMethod) return;
    doSubmit(code);
  };

  const checkoutBtnsDisabled = userAuthed === null;

  const tierLabel =
    chosenPlan && PLANS[chosenPlan]
      ? `${PLANS[chosenPlan].label} (${PLANS[chosenPlan].price})`
      : 'Choose your plan above';

  return (
    <div className="checkout-page-shell site-theme-pornwrld">
      <div
        className="checkout-page-root"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100000,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <header className="checkout-shell-header" role="banner">
          <div className="checkout-shell-header__inner">
            <Link to="/" className="checkout-shell-brand">
              Pornwrld
            </Link>
            <span className="checkout-shell-tag">Premium checkout</span>
          </div>
        </header>

        <div className="orbs">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
          <div className="orb orb-4" />
        </div>
        <canvas ref={canvasRef} id="checkout-particles" />

        <div className="content">
          <PageHero
            className="checkout-page-hero"
            title="Unlock the full archive"
            subtitle="One payment for lifetime tier access — or verify your Patreon email if you already support us there."
          />

          <div className="checkout-kpis" aria-label="Highlights">
            <div className="checkout-kpi">
              <span className="checkout-kpi__num">HD</span>
              <span className="checkout-kpi__lbl">streaming</span>
            </div>
            <div className="checkout-kpi">
              <span className="checkout-kpi__num">Daily</span>
              <span className="checkout-kpi__lbl">fresh drops</span>
            </div>
            <div className="checkout-kpi">
              <span className="checkout-kpi__num">9k+</span>
              <span className="checkout-kpi__lbl">members</span>
            </div>
          </div>

          <div className="image-slots" aria-label="Preview images">
            <div className="image-slot">
              <img src="/images/checkout/image1.png" alt="Preview 1" loading="lazy" decoding="async" />
            </div>
            <div className="image-slot">
              <img src="/images/checkout/image2.jpg" alt="Preview 2" loading="lazy" decoding="async" />
            </div>
          </div>

          <div
            ref={patreonCardRef}
            id="patreon-unlock-block"
            className={
              'checkout-patreon-card' +
              (patreonGuideActive ? ' checkout-patreon-card--guide-active' : '')
            }
            tabIndex={-1}
          >
            <div className="checkout-patreon-card__inner">
              {patreonGuideActive ? (
                <p className="checkout-patreon-card__eyebrow">Back from Patreon · next step</p>
              ) : null}
              <div className="checkout-patreon-card__header">
                <div className="checkout-patreon-card__icon-bubble" aria-hidden="true">
                  <PatreonMarkIcon size={17} className="checkout-patreon-card__mark" />
                </div>
                <div className="checkout-patreon-card__title">Already a Patreon member?</div>
              </div>
              <p className="checkout-patreon-card__hint">
                Enter the same email you used on Patreon — we&apos;ll match your tier and unlock access
                instantly.
              </p>
              <form
                id="patreon-unlock-form"
                autoComplete="off"
                className="checkout-patreon-card__form"
                onSubmit={patreonUnlockSubmit}
              >
                <input
                  id="patreon-unlock-email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  value={patreonEmail}
                  onChange={(e) => setPatreonEmail(e.target.value)}
                  onFocus={dismissPatreonGuide}
                  disabled={patreonBusy}
                  className="checkout-patreon-card__input"
                />
                <button
                  id="patreon-unlock-submit"
                  type="submit"
                  className="checkout-patreon-card__unlock"
                  disabled={patreonBusy}
                >
                  Unlock
                </button>
              </form>
              <div
                id="patreon-unlock-msg"
                role="status"
                aria-live="polite"
                className={
                  'checkout-patreon-card__msg' +
                  (patreonMsg.warm ? ' checkout-patreon-card__msg--warm' : '') +
                  (patreonMsg.error ? ' checkout-patreon-card__msg--error' : '')
                }
              >
                {patreonMsg.text}
              </div>
            </div>
          </div>

          <section className="checkout-pricing-wrap" aria-labelledby="checkout-pricing-heading">
            <div className="checkout-pricing-intro">
              <h2 id="checkout-pricing-heading" className="checkout-pricing-heading">
                Unlock the full archive
              </h2>
            </div>

            <div className="checkout-tier-package">
              <div className="checkout-pricing-grid checkout-pricing-grid--headers cards">
                <article className="card card-free">
                  <div className="checkout-tier-card__inner">
                    <div className="checkout-tier-card__badge-slot" aria-hidden="true" />
                    <div className="tier-label tier-label--dim">Preview tier</div>
                    <div className="tier-name tier-name--free">Free</div>
                    <div className="checkout-tier-card__spacer" aria-hidden="true" />
                    <div className="card-price-zone card-price-zone--free">
                      <div className="card-price-promo-slot" aria-hidden="true" />
                      <div className="price price--free">$0</div>
                      <div className="daily-price daily-price--dim">Shorts · teasers · ads</div>
                    </div>
                    <Link className="btn btn-free checkout-tier-card__cta" to="/signup">
                      Stay on free
                    </Link>
                  </div>
                </article>

                <article className="card basic">
                  <div className="checkout-tier-card__inner">
                    <div className="checkout-tier-card__badge-slot" aria-hidden="true" />
                    <div className="tier-label">Starter access</div>
                    <div className="tier-name">Basic</div>
                    <div className="checkout-tier-card__spacer" aria-hidden="true" />
                    <div className="card-price-zone">
                      <div className="card-price-promo-slot" aria-hidden="true" />
                      <div className="price">$9.99</div>
                      <div className="daily-price">~$0.33/day</div>
                      <div className="price-note">One-time · lifetime Tier 1</div>
                    </div>
                    <button
                      className="btn btn-basic checkout-tier-card__cta"
                      type="button"
                      disabled={checkoutBtnsDisabled}
                      aria-busy={checkoutBtnsDisabled ? 'true' : undefined}
                      data-checkout="basic"
                      onClick={() => openCheckout('basic')}
                    >
                      Get Basic — $9.99
                    </button>
                  </div>
                </article>

                <article className="card premium">
                  <div className="checkout-tier-card__inner">
                    <div className="checkout-tier-card__badge-slot">
                      <div className="crown">Highest tier</div>
                    </div>
                    <div className="tier-label">Best value</div>
                    <div className="tier-name">Premium</div>
                    <div className="checkout-tier-card__spacer" aria-hidden="true" />
                    <div className="card-price-zone card-price-zone--premium">
                      <div className="card-price-promo-slot">
                        <div className="premium-deal-strip">
                          <span className="discount-pill">25% off</span>
                          <span className="price-was">Was $33.32</span>
                        </div>
                      </div>
                      <div className="price">$24.99</div>
                      <div className="daily-price">~$0.83/day</div>
                      <div className="price-note">One-time · lifetime Tier 2</div>
                    </div>
                    <button
                      className="btn btn-premium checkout-tier-card__cta"
                      type="button"
                      disabled={checkoutBtnsDisabled}
                      aria-busy={checkoutBtnsDisabled ? 'true' : undefined}
                      data-checkout="premium"
                      onClick={() => openCheckout('premium')}
                    >
                      Get Premium — $24.99
                    </button>
                  </div>
                </article>
              </div>

              <div className="checkout-matrix-scroll" tabIndex={0}>
                <div className="checkout-tier-matrix" role="table" aria-label="Tier features compared">
                  <div className="checkout-tier-matrix__row checkout-tier-matrix__row--head" role="row">
                    <div className="checkout-tier-matrix__corner" role="columnheader">
                      Feature
                    </div>
                    <div className="checkout-tier-matrix__colhead checkout-tier-matrix__colhead--free" role="columnheader">
                      Free
                    </div>
                    <div className="checkout-tier-matrix__colhead checkout-tier-matrix__colhead--basic" role="columnheader">
                      Basic
                    </div>
                    <div className="checkout-tier-matrix__colhead checkout-tier-matrix__colhead--premium" role="columnheader">
                      Premium
                    </div>
                  </div>
                  {TIER_COMPARE_ROWS.map((row) => (
                    <div key={row.label} className="checkout-tier-matrix__row" role="row">
                      <div className="checkout-tier-matrix__label" role="rowheader">
                        {row.label}
                      </div>
                      <div
                        className="checkout-tier-matrix__cell checkout-tier-matrix__cell--free"
                        role="cell"
                      >
                        <CheckoutCompareCell value={row.free} />
                      </div>
                      <div
                        className="checkout-tier-matrix__cell checkout-tier-matrix__cell--basic"
                        role="cell"
                      >
                        <CheckoutCompareCell value={row.basic} />
                      </div>
                      <div
                        className="checkout-tier-matrix__cell checkout-tier-matrix__cell--premium"
                        role="cell"
                      >
                        <CheckoutCompareCell value={row.premium} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="trust-signals">
            <div className="trust-item">
              <span className="trust-icon">&#128274;</span>
              <strong>Secure Payment</strong>
            </div>
            <div className="trust-item">
              <span className="trust-icon">&#128176;</span>
              <strong>Cancel Anytime</strong>
            </div>
            <div className="trust-item">
              <span className="trust-icon">&#128101;</span>
              <strong>Join 9,000+ Members</strong>
            </div>
            <div className="trust-item">
              <span className="trust-icon">&#128179;</span>
              Charges appear as <strong>&lsquo;Digital Services&rsquo;</strong> on your statement
            </div>
          </div>

          <div className="faq-section">
            <div className="faq-title">Frequently Asked Questions</div>
            {faqItems().map((item, idx) => (
              <div key={idx} className={'faq-item' + (faqOpen === idx ? ' open' : '')}>
                <button
                  type="button"
                  className="faq-q"
                  onClick={() => setFaqOpen(faqOpen === idx ? null : idx)}
                >
                  {item.q}
                  <span className="arrow">&#9660;</span>
                </button>
                <div className="faq-a">
                  <p>{item.a}</p>
                </div>
              </div>
            ))}
          </div>

          <footer className="checkout-footer-note">
            Questions? Same support links as the rest of the site — Telegram in the footer when you&apos;re browsing.
          </footer>
        </div>
        <FooterSection />

        {/* Payment modal: tier CTAs open Patreon; overlay for manual screenshot flow */}
        <div
          className={'pay-overlay' + (payOpen ? ' active' : '')}
          id="pay-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePayModal();
          }}
        >
          <div className="pay-modal">
            <button className="pay-modal-close" id="pay-close" type="button" onClick={closePayModal}>
              <X size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>

            <div className={'pay-step' + (payStep === 1 ? ' active' : '')} id="co-step-1">
              <div className="pay-modal-title">Select Payment Method</div>
              <div className="pay-modal-plan" id="co-plan-label">
                {tierLabel}
              </div>
              <select className="pay-select" id="co-method-select" value={chosenMethod} onChange={onMethodChange}>
                <option value="" disabled>
                  Choose a method...
                </option>
                <option value="cashapp">Cash App</option>
                <option value="venmo">Venmo</option>
                <option value="paypal">PayPal</option>
                <option value="zelle">Zelle</option>
                <option value="applepay">Apple Pay</option>
                <option value="giftcard">Gift Card</option>
              </select>
              <div className="pay-detail" id="co-detail" hidden={!chosenMethod}>
                <div className="pay-detail-method" id="co-detail-method">
                  {detail ? detail.display : ''}
                </div>
                <div id="co-regular-info" style={{ display: showGift ? 'none' : '' }}>
                  <div className="pay-detail-info" id="co-detail-info">
                    {detail && !detail.isGiftCard ? detail.user : ''}
                  </div>
                  <ol className="pay-steps">
                    <li>Pay to the payment option above</li>
                    <li>When complete, upload a screenshot</li>
                    <li>Admins will give you access in 30 seconds</li>
                  </ol>
                  <div
                    className="pay-dropzone"
                    id="co-dropzone"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('dragover');
                    }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('dragover')}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('dragover');
                      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <div className="pay-dropzone-text">Click or drag screenshot here</div>
                    {/* preview shown via state if needed */}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="co-file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      if (e.target.files.length) handleFile(e.target.files[0]);
                    }}
                  />
                </div>
                <div id="co-giftcard-info" style={{ display: showGift ? 'block' : 'none' }}>
                  {GIFTCARD_PRODUCT_URL ? (
                  <a
                    href={GIFTCARD_PRODUCT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pay-gc-link"
                  >
                    CLICK TO PURCHASE GIFTCARD
                  </a>
                  ) : (
                    <p className="pay-gc-label" style={{ color: 'rgba(255,255,255,.45)' }}>
                      Set VITE_GIFTCARD_PRODUCT_URL in <code>.env</code> for the purchase link.
                    </p>
                  )}
                  <div className="pay-gc-label">Enter the code below:</div>
                  <input
                    type="text"
                    className="pay-gc-input"
                    id="co-gc-code"
                    placeholder="Enter gift card code..."
                    autoComplete="off"
                    value={gcCode}
                    onChange={(e) => setGcCode(e.target.value)}
                  />
                  <button type="button" className="pay-gc-submit" id="co-gc-submit" onClick={giftSubmit}>
                    Submit
                  </button>
                </div>
              </div>
            </div>

            <div className={'pay-step' + (payStep === 2 ? ' active' : '')} id="co-step-2">
              <div id="co-processing" className="pay-processing">
                {processError ? (
                  <>
                    <div className="pay-error-icon">&#10007;</div>
                    <div className="pay-processing-text">Something went wrong</div>
                    <div className="pay-processing-sub">{processError}</div>
                  </>
                ) : (
                  <>
                    <div className="pay-spinner" />
                    <div className="pay-processing-text">Verifying payment...</div>
                    <div className="pay-processing-sub">Please wait</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {successTier != null && (
          <div className="purchase-success-page">
            <div className="success-icon-wrap">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="success-title">Purchase Approved!</div>
            <div className="success-subtitle">
              Your payment has been verified and your account has been upgraded.
            </div>
            <div className={'success-tier-badge' + (successTier === 2 ? ' tier-2' : '')}>
              {(successTier === 2 ? 'Premium' : 'Tier 1') + ' Unlocked'}
            </div>
            <div className="success-msg">
              You now have access to {successTier === 2 ? '5,000+' : '1,000+'} exclusive videos across all
              categories. Do NOT resubmit your payment — your access is already active.
            </div>
            <Link to="/" className="success-browse-btn">
              Start Browsing
            </Link>
          </div>
        )}
      </div>
    </div>
    );
}
