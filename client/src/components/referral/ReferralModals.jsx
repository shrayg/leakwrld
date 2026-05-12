import { Copy, ExternalLink, MessageCircle, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  buildShareUrls,
  copyText,
  fetchReferralProgram,
  fetchReferralStatus,
} from '../../lib/referral';

/**
 * Two modals coordinated through AuthContext.referralModal:
 *   - 'share' : the standard share modal (link + copy + share buttons)
 *   - 'fast'  : the "Get referrals fast" Reddit playbook
 *
 * Both fetch the user's referral status on open so they always show fresh
 * data even if AuthContext hasn't refreshed.
 */
export function ReferralModals() {
  const { user, referralModal, openFastModal, closeReferral } = useAuth();
  const [status, setStatus] = useState(null);
  const [program, setProgram] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (referralModal === 'closed' || !user) return undefined;
    let cancelled = false;
    Promise.all([fetchReferralStatus(), fetchReferralProgram()]).then(([s, p]) => {
      if (cancelled) return;
      setStatus(s);
      setProgram(p);
    });
    return () => {
      cancelled = true;
    };
  }, [referralModal, user]);

  useEffect(() => {
    if (referralModal === 'closed') return undefined;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [referralModal]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  if (referralModal === 'closed') return null;

  const link = status?.shareUrl || status?.url || status?.longUrl || '';
  const share = buildShareUrls(link);

  async function handleCopy() {
    const ok = await copyText(link);
    setToast(ok ? 'Link copied!' : 'Copy failed — long-press the field to copy manually.');
  }

  if (referralModal === 'fast') {
    return (
      <FastModal
        link={link}
        program={program}
        onClose={closeReferral}
        onCopy={handleCopy}
        toast={toast}
      />
    );
  }

  return (
    <ShareModal
      link={link}
      status={status}
      share={share}
      onClose={closeReferral}
      onCopy={handleCopy}
      onOpenFast={openFastModal}
      toast={toast}
    />
  );
}

function ShareModal({ link, status, share, onClose, onCopy, onOpenFast, toast }) {
  return (
    <div className="lw-ref-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="lw-ref-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lw-ref-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="lw-ref-modal-close" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
        <h2 id="lw-ref-modal-title" className="lw-ref-modal-title">
          Share your link — earn premium + cash
        </h2>
        <p className="lw-ref-modal-sub">
          Every signup through your link counts toward lifetime tier unlocks. Once you cross 10
          referrals, you also earn <span className="lw-ref-gold">10%</span> of every payment your
          referrals make (bumps to 20% at 30+ referrals).
        </p>

        <div className="lw-ref-linkbox">
          <input className="lw-ref-link-input" readOnly value={link || 'Loading…'} />
          <button type="button" className="lw-ref-link-copy" onClick={onCopy} disabled={!link}>
            <Copy size={14} aria-hidden /> Copy
          </button>
        </div>

        <div className="lw-ref-share-grid">
          <a className="lw-ref-share-btn" href={share.redditPost} target="_blank" rel="noopener noreferrer">
            <span className="lw-ref-share-platform">Reddit</span>
            <span className="lw-ref-share-action">Post</span>
          </a>
          <a className="lw-ref-share-btn" href={share.redditComment} target="_blank" rel="noopener noreferrer">
            <span className="lw-ref-share-platform">Reddit</span>
            <span className="lw-ref-share-action">Comment</span>
          </a>
          <a className="lw-ref-share-btn" href={share.xPost} target="_blank" rel="noopener noreferrer">
            <span className="lw-ref-share-platform">X</span>
            <span className="lw-ref-share-action">Post</span>
          </a>
          <a className="lw-ref-share-btn" href={share.telegram} target="_blank" rel="noopener noreferrer">
            <span className="lw-ref-share-platform">Telegram</span>
            <span className="lw-ref-share-action">Share</span>
          </a>
        </div>

        {status ? (
          <div className="lw-ref-modal-stats">
            <div>
              <span>Signups</span>
              <strong>{status.count || 0}</strong>
            </div>
            <div>
              <span>Earned</span>
              <strong>${((status.earnedCents || 0) / 100).toFixed(2)}</strong>
            </div>
            <div>
              <span>Rate</span>
              <strong>
                {status.revshareUnlocked
                  ? `${((status.revshareRateBps || 0) / 100).toFixed(0)}%`
                  : 'Locked'}
              </strong>
            </div>
          </div>
        ) : null}

        <div className="lw-ref-modal-actions">
          <button type="button" className="lw-ref-secondary-btn" onClick={onOpenFast}>
            <MessageCircle size={14} aria-hidden /> Get referrals fast
          </button>
          <Link className="lw-ref-link" to="/refer" onClick={onClose}>
            Open the referral program →
          </Link>
        </div>

        <div className="lw-ref-toast" aria-live="polite">
          {toast}
        </div>
      </div>
    </div>
  );
}

function FastModal({ link, program, onClose, onCopy, toast }) {
  const reddit = program?.redditFastUrl || 'https://www.reddit.com/search/?q=leaks&type=posts&t=week';
  return (
    <div className="lw-ref-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="lw-ref-modal lw-ref-modal--fast"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lw-ref-fast-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="lw-ref-modal-close" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
        <h2 id="lw-ref-fast-title" className="lw-ref-modal-title">
          Get referrals fast
        </h2>
        <p className="lw-ref-modal-sub">
          The Reddit playbook below works — fresh threads + helpful tone, not link-dumping.
        </p>

        <a className="lw-ref-fast-reddit" href={reddit} target="_blank" rel="noopener noreferrer">
          <Send size={14} aria-hidden /> Open active leak threads on Reddit
          <ExternalLink size={14} aria-hidden style={{ marginLeft: 'auto' }} />
        </a>

        <ol className="lw-ref-fast-steps">
          <li>
            Find threads where someone is asking where to watch / find content. (The Reddit link above
            pre-searches active ones.)
          </li>
          <li>
            <strong>Reply, don't post.</strong> Drop your link in a comment that sounds like a real
            person. One per thread.
          </li>
          <li>
            <strong>Don't spam the same sub.</strong> 1–2 comments per sub per day or you'll get
            shadowbanned.
          </li>
          <li>
            Use your <strong>short link</strong> (the one below) — it looks less like an affiliate
            link.
          </li>
        </ol>

        <div className="lw-ref-fast-copybox" role="button" tabIndex={0} onClick={onCopy} onKeyDown={(e) => e.key === 'Enter' && onCopy()}>
          <span className="lw-ref-fast-copytext">{link || 'Loading link…'}</span>
          <span className="lw-ref-fast-copyhint">Click to copy</span>
        </div>

        <p className="lw-ref-fast-foot">
          Want the full playbook with post templates and a safe-subreddit list?{' '}
          <Link className="lw-ref-inline-link" to="/refer" onClick={onClose}>
            Open the referral program →
          </Link>
        </p>

        <div className="lw-ref-toast" aria-live="polite">
          {toast}
        </div>
      </div>
    </div>
  );
}
