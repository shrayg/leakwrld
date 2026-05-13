import { Copy, MessageCircle, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  buildShareUrls,
  copyText,
  fetchReferralStatus,
} from '../../lib/referral';
import { RedditMark, XMark } from './BrandMarks';

/** Hardcoded for now — the user explicitly said "just use this link for now,
 *  I'm going to think more tomorrow." We'll wire a per-user / per-subreddit
 *  rotation later. Keeping it inline (not in env) on purpose so the placeholder
 *  is obvious to anyone reading the code. */
const FAST_REDDIT_URL =
  'https://www.reddit.com/r/omeglecockshockreal/submit/?type=LINK' +
  '&url=https%3A%2F%2Fwww.redgifs.com%2Fwatch%2Feverymountainoustadpole' +
  '&title=ome.tv+omegle+monkey+app+win+%7C+pornyard.xyz+full+video';

/** Pre-written comment users paste under their submitted Reddit post. */
function buildFastComment(link) {
  return `${link || 'https://leakwrld.com/r/YOURCODE'} you won't find better than this`;
}

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
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (referralModal === 'closed' || !user) return undefined;
    let cancelled = false;
    fetchReferralStatus().then((s) => {
      if (cancelled) return;
      setStatus(s);
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
        onClose={closeReferral}
        toast={toast}
        setToast={setToast}
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
            <RedditMark size={26} className="lw-ref-share-icon lw-ref-share-icon--reddit" />
            <span className="lw-ref-share-btn-text">
              <span className="lw-ref-share-platform">Reddit</span>
              <span className="lw-ref-share-action">Post</span>
            </span>
          </a>
          <a className="lw-ref-share-btn" href={share.redditComment} target="_blank" rel="noopener noreferrer">
            <RedditMark size={26} className="lw-ref-share-icon lw-ref-share-icon--reddit" />
            <span className="lw-ref-share-btn-text">
              <span className="lw-ref-share-platform">Reddit</span>
              <span className="lw-ref-share-action">Comment</span>
            </span>
          </a>
          <a className="lw-ref-share-btn" href={share.xPost} target="_blank" rel="noopener noreferrer">
            <XMark size={24} className="lw-ref-share-icon lw-ref-share-icon--x" />
            <span className="lw-ref-share-btn-text">
              <span className="lw-ref-share-platform">X</span>
              <span className="lw-ref-share-action">Post</span>
            </span>
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

function FastModal({ link, onClose, toast, setToast }) {
  /** Pre-baked comment text — same shape as pornyard's flow but pointed at
   *  the current user's short link. We copy the whole string in one shot
   *  so the user just pastes after clicking REPLY on Reddit. */
  const comment = buildFastComment(link);

  async function copyComment() {
    const ok = await copyText(comment);
    setToast(ok ? 'Comment copied — paste it on Reddit.' : 'Copy failed — long-press to copy.');
  }

  return (
    <div className="lw-ref-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="lw-ref-modal lw-ref-modal--fast lw-fast"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lw-fast-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="lw-ref-modal-close" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>

        <div className="lw-fast-badge">
          <Zap size={13} aria-hidden /> ACCESS IN MINUTES
        </div>

        <h2 id="lw-fast-title" className="lw-fast-title">
          GET REFERRALS FAST
        </h2>

        <a
          className="lw-fast-reddit-btn"
          href={FAST_REDDIT_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <RedditMark size={26} />
          <span>OPEN THIS REDDIT</span>
        </a>

        <ol className="lw-fast-steps">
          <li>Click the link above</li>
          <li>Click &lsquo;POST&rsquo;</li>
          <li>Reply to the post with your referral link</li>
        </ol>

        <div className="lw-fast-comment">
          <span className="lw-fast-comment-text" title={comment}>
            {comment}
          </span>
          <button
            type="button"
            className="lw-fast-comment-copy"
            aria-label="Copy comment text"
            onClick={copyComment}
            disabled={!link}
          >
            <Copy size={16} aria-hidden />
          </button>
        </div>

        <p className="lw-fast-foot">this gives you 5 referrals per hour</p>

        <div className="lw-ref-toast" aria-live="polite">
          {toast}
        </div>
      </div>
    </div>
  );
}
