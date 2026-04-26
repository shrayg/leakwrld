import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useShell } from '../../context/ShellContext';
import { fetchReferralStatus } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';

async function copyText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ReferralModals() {
  const navigate = useNavigate();
  const { referralOpen, closeReferral, fastOpen, openFast, closeFast, openAuth } = useShell();
  const { isAuthed } = useAuth();
  const [linkUrl, setLinkUrl] = useState('');
  const [copied, setCopied] = useState('');
  const [fastCopied, setFastCopied] = useState('');

  useEffect(() => {
    if (!referralOpen) return;
    if (!isAuthed) {
      closeReferral();
      openAuth('signup');
    }
  }, [referralOpen, isAuthed, closeReferral, openAuth]);

  useEffect(() => {
    if (!(referralOpen || fastOpen) || !isAuthed) return;
    let cancelled = false;
    (async () => {
      const r = await fetchReferralStatus();
      if (cancelled || !r.ok || !r.data) return;
      const count = Number(r.data.count || 0);
      const goal = Number(r.data.goal || 1);
      if (referralOpen && count >= goal) {
        closeReferral();
        navigate('/checkout');
        return;
      }
      setLinkUrl(String(r.data.url || ''));
    })();
    return () => {
      cancelled = true;
    };
  }, [referralOpen, fastOpen, isAuthed, navigate, closeReferral]);

  useEffect(() => {
    if (!referralOpen && !fastOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [referralOpen, fastOpen]);

  async function handleCopy() {
    const ok = await copyText(linkUrl);
    setCopied(ok ? 'Copied!' : 'Copy failed');
    setTimeout(() => setCopied(''), 2500);
  }

  async function handleFastCopy() {
    const ok = await copyText(linkUrl);
    setFastCopied(ok ? 'Copied!' : 'Copy failed');
    setTimeout(() => setFastCopied(''), 2500);
  }

  if (!referralOpen && !fastOpen) return null;

  return (
    <>
      {referralOpen && isAuthed && (
        <div className="referral-overlay active" id="referral-overlay" aria-hidden="false" role="presentation" onClick={(e) => e.target === e.currentTarget && closeReferral()}>
          <div className="referral-modal" role="dialog" aria-modal="true" aria-labelledby="referral-title" onClick={(e) => e.stopPropagation()}>
            <button className="referral-close" id="referral-close" type="button" aria-label="Close" onClick={closeReferral}>
              <X className="referral-close-icon" size={18} strokeWidth={2.25} aria-hidden="true" />
            </button>

            <h2 id="referral-title">GET FULL ACCESS IN MINUTES</h2>
            <p className="referral-body">Share your referral link with others:</p>

            <div className="referral-linkbox">
              <div className="referral-linkrow">
                <input id="referral-link" className="referral-link" readOnly value={linkUrl} placeholder="Loading your link…" />
                <button className="referral-copy" id="referral-copy" type="button" onClick={handleCopy}>
                  Copy
                </button>
              </div>
              <div className="referral-tierhint">
                <div className="hint-line">Basic access = 1 signup</div>
              </div>
              <p className="referral-modal__kicker">Top 5 referrers paid weekly</p>
              <button
                className="referral-fast-btn"
                id="referral-fast-btn"
                type="button"
                onClick={() => {
                  closeReferral();
                  openFast();
                }}
              >
                GET REFERRALS FAST
              </button>
              <button
                className="referral-premium-btn"
                id="open-payment"
                type="button"
                onClick={() => {
                  closeReferral();
                  navigate('/checkout');
                }}
              >
                CLICK FOR INSTANT ACCESS
              </button>
              <div className="referral-copied" id="referral-copied" aria-live="polite">
                {copied}
              </div>
            </div>
          </div>
        </div>
      )}

      {fastOpen && (
        <div className="referral-fast-overlay active" id="referral-fast-overlay" aria-hidden="false" role="presentation" onClick={(e) => e.target === e.currentTarget && closeFast()}>
          <div className="referral-fast-modal" role="dialog" aria-modal="true" aria-labelledby="referral-fast-title" onClick={(e) => e.stopPropagation()}>
            <button className="referral-fast-close" id="referral-fast-close" type="button" aria-label="Close" onClick={closeFast}>
              <X className="referral-close-icon" size={18} strokeWidth={2.25} aria-hidden="true" />
            </button>
            <h2 id="referral-fast-title">GET REFERRALS FAST</h2>
            <div className="referral-fast-grid">
              <a
                className="referral-fast-reddit-card"
                href="https://www.reddit.com/search/?q=ome+nsfw%3Ayes+self%3Ano&type=posts&t=month"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>OPEN THIS REDDIT</span>
              </a>
            </div>
            <div className="referral-fast-instruction">
              <p className="referral-fast-step">1. Post your referral under 5 posts</p>
              <p className="referral-fast-step">2. Reply to others&apos; replies with &quot;facts best site&quot;</p>
            </div>
            <div className="referral-fast-copybox" id="referral-fast-copybox" title="Click to copy" role="button" tabIndex={0} onClick={handleFastCopy} onKeyDown={(e) => e.key === 'Enter' && handleFastCopy()}>
              <span className="referral-fast-copytext" id="referral-fast-inline-link">
                {linkUrl || 'Loading your referral link…'}
              </span>
            </div>
            <div className="referral-fast-copied" id="referral-fast-copied" aria-live="polite">
              {fastCopied}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
