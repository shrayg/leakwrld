import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useShell } from '../context/ShellContext';
import { PatreonMarkIcon } from '../components/icons/PatreonMarkIcon';
import { PageHero } from '../components/layout/PageHero';
import { FooterSection } from '../components/ui/footer-section';
import { OFFICIAL_DISCORD_INVITE_URL, OFFICIAL_TELEGRAM_URL } from '../constants/officialContact';
import './checkout/checkout-page.css';

/** Public URLs — set in repo-root `.env` (`VITE_*`, loaded by Vite). Never commit secrets; values are embedded in the JS bundle. */

const SUPPORT_TELEGRAM_URL = String(import.meta.env.VITE_SUPPORT_TELEGRAM_URL || OFFICIAL_TELEGRAM_URL).trim();
const SUPPORT_DISCORD_URL = String(import.meta.env.VITE_SUPPORT_DISCORD_URL || OFFICIAL_DISCORD_INVITE_URL).trim();

/** After opening Patreon, remind returning users where to enter email (see visibility/focus handler). */
const PATREON_RETURN_GUIDE_KEY = 'checkout_expect_patreon_unlock';

/** Default Patreon checkout links (override with `VITE_PATREON_CHECKOUT_*_URL` in `.env`). */
const DEFAULT_PATREON_CHECKOUT_URLS = {
  basic: 'https://www.patreon.com/checkout/PornWrld?rid=28462115',
  premium: 'https://www.patreon.com/checkout/PornWrld?rid=28462116',
  ultimate: 'https://www.patreon.com/checkout/PornWrld?rid=28462118',
};

const PLAN_ORDER = ['basic', 'premium', 'ultimate'];

const PLANS = {
  basic: {
    label: 'Basic',
    price: '$9.99',
    blurb: '/mo',
    tierNum: 1,
    checkoutUrl: String(
      import.meta.env.VITE_PATREON_CHECKOUT_BASIC_URL || DEFAULT_PATREON_CHECKOUT_URLS.basic,
    ).trim(),
    cardClass: 'basic',
    btnClass: 'btn-basic',
  },
  premium: {
    label: 'Premium',
    price: '$24.99',
    blurb: '/mo',
    tierNum: 2,
    checkoutUrl: String(
      import.meta.env.VITE_PATREON_CHECKOUT_PREMIUM_URL || DEFAULT_PATREON_CHECKOUT_URLS.premium,
    ).trim(),
    cardClass: 'premium',
    btnClass: 'btn-premium',
  },
  ultimate: {
    label: 'Ultimate',
    price: '$39.99',
    blurb: '/mo',
    tierNum: 3,
    checkoutUrl: String(
      import.meta.env.VITE_PATREON_CHECKOUT_ULTIMATE_URL || DEFAULT_PATREON_CHECKOUT_URLS.ultimate,
    ).trim(),
    cardClass: 'ultimate',
    btnClass: 'btn-ultimate',
  },
};

/** Free + three paid columns — cells align per row. */
const TIER_COMPARE_ROWS = [
  {
    label: 'Full-length library',
    free: '500+ previews',
    basic: '1,000+ videos',
    premium: '5,000+ videos',
    ultimate: '5,000+ videos',
  },
  {
    label: 'OnlyFans leaks vault',
    free: false,
    basic: false,
    premium: true,
    ultimate: true,
  },
  {
    label: 'HD playback (full videos)',
    free: false,
    basic: true,
    premium: true,
    ultimate: true,
  },
  {
    label: 'Ad-free experience',
    free: false,
    basic: true,
    premium: true,
    ultimate: true,
  },
  {
    label: 'Daily new uploads',
    free: false,
    basic: '+10 GB / day',
    premium: '+10 GB + mega vault sync',
    ultimate: '+10 GB + mega vault sync',
  },
  {
    label: 'Banana Girl & niche vaults',
    free: false,
    basic: false,
    premium: true,
    ultimate: true,
  },
  {
    label: 'Custom model videos',
    free: false,
    basic: false,
    premium: true,
    ultimate: true,
  },
  {
    label: 'Exclusive drops & early access',
    free: false,
    basic: false,
    premium: true,
    ultimate: true,
  },
  {
    label: 'Support priority',
    free: '—',
    basic: 'Standard',
    premium: 'Priority',
    ultimate: 'Top priority',
  },
  {
    label: 'Billing',
    free: '—',
    basic: 'Patreon monthly',
    premium: 'Patreon monthly',
    ultimate: 'Patreon monthly',
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
      q: 'How do I pay and unlock?',
      a: 'Choose a tier and complete checkout on Patreon. Then return here, enter the same email you use on Patreon, and tap Unlock — we match your pledge to your account.',
    },
    {
      q: 'How long does access take?',
      a: 'Usually seconds after Patreon shows an active pledge. If you just subscribed, wait a moment and try Unlock again.',
    },
    {
      q: 'What if my payment or unlock fails?',
      a: (
        <>
          We only support billing help through our official{' '}
          <a href={SUPPORT_DISCORD_URL} target="_blank" rel="noopener noreferrer">
            Discord
          </a>{' '}
          and{' '}
          {SUPPORT_TELEGRAM_URL ? (
            <a href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Telegram
            </a>
          ) : (
            'Telegram (see footer)'
          )}
          . We do not take payments or verify purchases outside Patreon on this page.
        </>
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
  const { openAuth } = useShell();
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const [searchParams] = useSearchParams();

  const [userAuthed, setUserAuthed] = useState(null);
  const [patreonEmail, setPatreonEmail] = useState('');
  const [patreonBusy, setPatreonBusy] = useState(false);
  const [patreonMsg, setPatreonMsg] = useState({ text: '', error: false, warm: false });
  const [patreonGuideActive, setPatreonGuideActive] = useState(false);
  const patreonCardRef = useRef(null);

  const [faqOpen, setFaqOpen] = useState(null);

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

  const redirectToLogin = useCallback(
    (plan) => {
      try {
        sessionStorage.setItem('checkout_return', '/checkout?plan=' + plan);
        sessionStorage.setItem('checkout_pending_plan', plan);
      } catch {
        /* ignore */
      }
      openAuth('login');
    },
    [openAuth],
  );

  const openScriptCheckout = useCallback(
    (url, qty, existingPopup) => {
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
    },
    [withQty],
  );

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
          openAuth('login');
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
    [openScriptCheckout, searchParams],
  );

  const openCheckout = useCallback(
    (plan) => {
      if (userAuthed === true) {
        doOpenPatreonModal(plan);
        return;
      }
      if (userAuthed === false) redirectToLogin(plan);
    },
    [userAuthed, doOpenPatreonModal, redirectToLogin],
  );

  const checkoutBtnsDisabled = userAuthed === null;

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
            subtitle="Monthly membership on Patreon — three tiers. After paying, return here and enter your Patreon email to sync access."
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
              <img src="/assets/images/checkout/image1.png" alt="Preview 1" loading="lazy" decoding="async" />
            </div>
            <div className="image-slot">
              <img src="/assets/images/checkout/image2.jpg" alt="Preview 2" loading="lazy" decoding="async" />
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
                Choose your Patreon tier
              </h2>
            </div>

            <div className="checkout-tier-package">
              <div className="checkout-pricing-grid checkout-pricing-grid--headers cards checkout-pricing-grid--five">
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
                    <button
                      className="btn btn-free checkout-tier-card__cta"
                      type="button"
                      onClick={() => openAuth('signup')}
                    >
                      Stay on free
                    </button>
                  </div>
                </article>

                {PLAN_ORDER.map((key) => {
                  const p = PLANS[key];
                  const missingUrl = !p.checkoutUrl;
                  return (
                    <article key={key} className={'card ' + p.cardClass}>
                      <div className="checkout-tier-card__inner">
                        <div className="checkout-tier-card__badge-slot" aria-hidden="true" />
                        <div className="tier-label">Tier {p.tierNum}</div>
                        <div className="tier-name">{p.label}</div>
                        <div className="checkout-tier-card__spacer" aria-hidden="true" />
                        <div className="card-price-zone">
                          <div className="card-price-promo-slot" aria-hidden="true" />
                          <div className="price">{p.price}</div>
                          <div className="daily-price">{p.blurb}</div>
                          <div className="price-note">Patreon · cancel anytime</div>
                        </div>
                        <button
                          className={'btn ' + p.btnClass + ' checkout-tier-card__cta'}
                          type="button"
                          disabled={checkoutBtnsDisabled || missingUrl}
                          title={missingUrl ? 'Set VITE_PATREON_CHECKOUT_*_URL in .env' : undefined}
                          aria-busy={checkoutBtnsDisabled ? 'true' : undefined}
                          data-checkout={key}
                          onClick={() => openCheckout(key)}
                        >
                          {missingUrl ? 'Configure Patreon URL' : `Join ${p.label} on Patreon`}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="checkout-matrix-scroll" tabIndex={0}>
                <div
                  className="checkout-tier-matrix checkout-tier-matrix--five"
                  role="table"
                  aria-label="Tier features compared"
                >
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
                    <div className="checkout-tier-matrix__colhead checkout-tier-matrix__colhead--ultimate" role="columnheader">
                      Ultimate
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
                      <div
                        className="checkout-tier-matrix__cell checkout-tier-matrix__cell--ultimate"
                        role="cell"
                      >
                        <CheckoutCompareCell value={row.ultimate} />
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
              <strong>Billed on Patreon</strong>
            </div>
            <div className="trust-item">
              <span className="trust-icon">&#128176;</span>
              <strong>Cancel anytime</strong>
            </div>
            <div className="trust-item">
              <span className="trust-icon">&#128101;</span>
              <strong>Join 9,000+ members</strong>
            </div>
            <div className="trust-item">
              <span className="trust-icon">&#128172;</span>
              <strong>Support via Discord &amp; Telegram only</strong>
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
            Questions? Use our official{' '}
            <a href={OFFICIAL_DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
              Discord
            </a>{' '}
            or{' '}
            <a href={SUPPORT_TELEGRAM_URL || OFFICIAL_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Telegram
            </a>
            — the only channels we use for support and payment issues. We do not accept alternate payment methods on this page.
          </footer>
        </div>
        <FooterSection />
      </div>
    </div>
  );
}
