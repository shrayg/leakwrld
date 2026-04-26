import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'age_verified';

export function AgeDisclaimer() {
  const [show, setShow] = useState(() => typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) !== 'true');
  const [canAccept, setCanAccept] = useState(false);
  const boxRef = useRef(null);

  const syncCanAccept = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const thresholdPx = 10;
    const reachedBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - thresholdPx;
    setCanAccept(reachedBottom);
  }, []);

  function accept() {
    if (!canAccept) return;
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      /* ignore */
    }
    sessionStorage.setItem('age_verified', 'true');
    setShow(false);
  }

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') setShow(false);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!show) return;
    const box = boxRef.current;
    if (!box) return;
    syncCanAccept();
    box.addEventListener('scroll', syncCanAccept, { passive: true });
    window.addEventListener('resize', syncCanAccept);
    return () => {
      box.removeEventListener('scroll', syncCanAccept);
      window.removeEventListener('resize', syncCanAccept);
    };
  }, [show, syncCanAccept]);

  if (!show) return null;

  return (
    <div className="disclaimer-overlay" id="disclaimer-overlay" style={{ display: 'flex' }}>
      <div className="disclaimer-box" ref={boxRef}>
        <img className="disclaimer-top-preview" src="/images/top_preview.png" alt="" loading="eager" onError={(e) => { e.target.style.display = 'none'; }} />
        <h2>⚠ Age Verification Required</h2>
        <p className="subtitle">You must verify your age before proceeding</p>

        <div className="divider" />

        <span className="warning-badge">18+ Content Warning</span>

        <p>
          <strong>This website contains adult content</strong> intended exclusively for individuals who are <strong>at least 18 years of age</strong>. All individuals depicted in any content are confirmed to be <strong>18+ years old</strong>.
        </p>

        <p>By clicking &quot;I Accept &amp; Enter&quot; below, you confirm:</p>

        <ul>
          <li>
            You are at least <strong>18 years old</strong>
          </li>
          <li>
            You understand this site contains <strong>explicit adult content</strong>
          </li>
          <li>
            Accessing this content is <strong>legal in your jurisdiction</strong>
          </li>
          <li>You will not share content with minors</li>
        </ul>

        <div className="divider" />
        <div className={'disclaimer-consent-sticky' + (canAccept ? ' is-ready' : '')}>
          <p className="disclaimer-consent-note">
            <strong>If you are under 18 or do not agree to these terms, you must leave immediately.</strong>
          </p>
          <button
            className={'btn-accept' + (canAccept ? ' btn-accept--ready' : ' btn-accept--locked')}
            id="accept-btn"
            type="button"
            onClick={accept}
            disabled={!canAccept}
            aria-disabled={!canAccept}
          >
            <span className="btn-accept__text btn-accept__text--locked">Scroll to the bottom to agree &amp; enter</span>
            <span className="btn-accept__text btn-accept__text--ready">I Accept &amp; Enter — I Am 18+</span>
          </button>
        </div>
      </div>
    </div>
  );
}
