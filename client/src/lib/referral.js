import { apiGet, apiPost } from '../api';

/**
 * Leak World referral — client-side fetchers + share helpers.
 *
 *  All percentages are stored on the server in basis points (1 bp = 0.01 %)
 *  so `rateBps / 100` gives a human-readable percentage.
 */

/** Canonical Leak World Telegram URL — mirrors server/referralProgram.js
 *  TELEGRAM_URL_DEFAULT so the link still surfaces if /api/referral/program
 *  is briefly unavailable or the client is still hydrating. */
export const TELEGRAM_URL = 'https://t.me/leakwrldcom';

const PROGRAM_FALLBACK = {
  ok: true,
  memo: {
    pitch: 'Earn access AND earn money.',
    payout: 'Request payouts via Telegram.',
  },
  tierLadder: [
    { threshold: 3, tier: 'basic', label: 'Lifetime Tier 1' },
    { threshold: 15, tier: 'premium', label: 'Lifetime Tier 2' },
    { threshold: 30, tier: 'ultimate', label: 'Lifetime Tier 3' },
  ],
  revshareLadder: [
    { threshold: 10, rateBps: 1000, label: '10% revshare' },
    { threshold: 30, rateBps: 2000, label: '20% revshare' },
  ],
  telegramPayoutUrl: TELEGRAM_URL,
  redditFastUrl: 'https://www.reddit.com/search/?q=leaks&type=posts&t=week',
};

const STATUS_FALLBACK = {
  ok: false,
  code: '',
  url: '',
  shareUrl: '',
  longUrl: '',
  count: 0,
  goal: 3,
  goalLabel: 'Lifetime Tier 1',
  nextTier: 'basic',
  revshareUnlocked: false,
  revshareRateBps: 0,
  revshareNextGoal: 10,
  revshareNextRateBps: 1000,
  lifetimeTier: null,
  earnedCents: 0,
  paidCents: 0,
  pendingCents: 0,
  telegramPayoutUrl: TELEGRAM_URL,
};

export async function fetchReferralProgram() {
  return apiGet('/api/referral/program', PROGRAM_FALLBACK);
}

export async function fetchReferralStatus() {
  return apiGet('/api/referral/status', STATUS_FALLBACK);
}

export async function fetchLeaderboard(page = 0, period = 'weekly') {
  return apiGet(`/api/referral/leaderboard?page=${page}&period=${period}`, {
    ok: true,
    page: 0,
    totalPages: 1,
    entries: [],
    period,
  });
}

export async function savePayoutHandle(handle) {
  return apiPost('/api/me/referral/payout-handle', { handle: String(handle || '') });
}

/* ─── Share URL builders ──────────────────────────────────────────────────
 *
 *  We never embed a bare link in a Reddit post title — Reddit auto-removes
 *  obvious affiliate spam. The post helper opens the submit page with the
 *  link + a generic title; the comment helper pre-fills a "leave this in
 *  comments" template that users can paste into existing threads.
 */
export function buildShareUrls(linkUrl) {
  const blank = { xPost: '#', xComment: '#', redditPost: '#', redditComment: '#', telegram: '#' };
  if (!linkUrl) return blank;
  const xPostText = `Best leaks archive I've found — ${linkUrl}`;
  const xCommentText = `If you're looking, this site has everything mirrored: ${linkUrl}`;
  const redditTitle = 'Leak World — full archive, mirrored daily';
  const redditCommentText = `Drop this in comments where it fits the sub's rules:\n${linkUrl}`;
  const telegramText = `Check this out — ${linkUrl}`;
  return {
    xPost: `https://twitter.com/intent/tweet?text=${encodeURIComponent(xPostText)}`,
    xComment: `https://twitter.com/intent/tweet?text=${encodeURIComponent(xCommentText)}`,
    redditPost: `https://www.reddit.com/submit?url=${encodeURIComponent(linkUrl)}&title=${encodeURIComponent(redditTitle)}`,
    redditComment: `https://www.reddit.com/submit?selftext=true&title=${encodeURIComponent('Leak World')}&text=${encodeURIComponent(redditCommentText)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(linkUrl)}&text=${encodeURIComponent(telegramText)}`,
  };
}

/** Robust copy-to-clipboard with a textarea fallback for older browsers /
 *  privacy-mode contexts where `navigator.clipboard` is blocked. */
export async function copyText(text) {
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
      return !!ok;
    } catch {
      return false;
    }
  }
}

export function formatCents(cents) {
  const n = Math.max(0, Number(cents) || 0);
  return `$${(n / 100).toFixed(2)}`;
}

export function formatRate(bps) {
  const n = Math.max(0, Number(bps) || 0);
  return `${(n / 100).toFixed(0)}%`;
}

/** Build a "post template" the user can paste into Reddit / X / Telegram. The
 *  template is parameterised so the operator can rotate copy later without
 *  shipping new code. */
export function buildPostTemplates(linkUrl) {
  const u = String(linkUrl || 'https://leakwrld.com');
  return [
    {
      id: 'reddit_short',
      platform: 'Reddit (comment)',
      copy: `Best site I've found for this — ${u}`,
    },
    {
      id: 'reddit_long',
      platform: 'Reddit (text post)',
      copy:
        `Tired of dead leak links? This one actually mirrors everything daily so nothing disappears.\n\nFree previews, full premium for the rest.\n\n${u}`,
    },
    {
      id: 'twitter',
      platform: 'X / Twitter',
      copy: `Daily-mirrored leaks archive (free previews + premium): ${u}`,
    },
    {
      id: 'telegram',
      platform: 'Telegram / Discord',
      copy: `Posting this once because it actually works: ${u}`,
    },
  ];
}
