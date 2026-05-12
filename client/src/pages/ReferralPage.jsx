import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Gift,
  Lightbulb,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { GoldPremiumFx } from '../components/referral/GoldPremiumFx';
import {
  POST_TEMPLATES,
  SUBREDDITS,
  TIPS,
  UTM_TEMPLATES,
  WARNINGS,
} from '../data/referralPlaybook';
import {
  buildShareUrls,
  copyText,
  fetchReferralProgram,
  fetchReferralStatus,
  savePayoutHandle,
} from '../lib/referral';

/**
 * /refer — the single, authoritative referral page.
 *
 * Contains:
 *   1. Hero      — pitch + the user's link with copy & share controls
 *   2. Metrics   — signups, lifetime tier, earnings, pending payout
 *   3. Program   — tier ladder + cash revshare ladder + rules + payout CTA
 *   4. Playbook  — "how to get referrals fast" (post templates, subs, tips, warnings)
 *
 * Guests see the explainer + playbook with a placeholder link, plus a signup
 * CTA. Authed users get their real link wired everywhere and live metrics.
 */
export function ReferralPage() {
  const { user, openAuthModal } = useAuth();
  const [status, setStatus] = useState(null);
  const [program, setProgram] = useState(null);
  const [toast, setToast] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [handle, setHandle] = useState('');
  const [savingHandle, setSavingHandle] = useState(false);

  useEffect(() => {
    document.title = 'Referral program · Leak World';
  }, []);

  useEffect(() => {
    let cancelled = false;
    /** Program rules are public — fetch them regardless of auth state. */
    fetchReferralProgram().then((p) => {
      if (!cancelled) setProgram(p);
    });
    if (user) {
      fetchReferralStatus().then((s) => {
        if (!cancelled) setStatus(s);
      });
    } else {
      setStatus(null);
    }
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /** Real link if authed, deterministic placeholder otherwise — keeps the
   *  templates and UTM examples meaningful for guests browsing the page. */
  const link = status?.shareUrl || status?.longUrl || status?.url || 'https://leakwrld.com/r/YOURCODE';
  const code = status?.code || 'YOURCODE';
  const share = useMemo(() => buildShareUrls(link), [link]);
  const telegram = status?.telegramPayoutUrl || program?.telegramPayoutUrl || '';
  const fastReddit = program?.redditFastUrl || 'https://www.reddit.com/search/?q=leaks&type=posts&t=week';

  async function doCopy(value, label, idForCopiedState) {
    if (!value) return;
    const ok = await copyText(value);
    if (ok && idForCopiedState) {
      setCopiedId(idForCopiedState);
      setTimeout(() => setCopiedId(''), 1800);
    }
    setToast(ok ? `${label} copied.` : `Could not copy ${label.toLowerCase()}.`);
  }

  async function copyTemplate(template) {
    const body = String(template.body || '').replaceAll('{{link}}', link);
    await doCopy(body, 'Template', template.id);
  }

  async function copyLinkWithUtm(extra = '') {
    const sep = link.includes('?') ? '&' : '?';
    const out = extra ? `${link}${sep}${extra}` : link;
    await doCopy(out, 'Link', `link-${extra || 'plain'}`);
  }

  async function handleSaveHandle() {
    const v = handle.trim();
    if (!v) return;
    setSavingHandle(true);
    try {
      await savePayoutHandle(v);
      setToast('Telegram handle saved.');
    } catch {
      setToast('Could not save handle — try again.');
    } finally {
      setSavingHandle(false);
    }
  }

  return (
    <article className="lw-refpage">
      <HeroSection
        user={user}
        link={link}
        code={code}
        share={share}
        program={program}
        copiedId={copiedId}
        onCopyLink={() => doCopy(link, 'Link', 'link-plain')}
        onCopyCode={() => doCopy(code, 'Code', 'code')}
        onSignup={() => openAuthModal('signup')}
      />

      {user ? (
        <MetricsSection
          status={status}
          telegram={telegram}
          handle={handle}
          savingHandle={savingHandle}
          onHandleChange={setHandle}
          onSaveHandle={handleSaveHandle}
        />
      ) : (
        <GuestCallout onSignup={() => openAuthModal('signup')} />
      )}

      <HowItWorksSection status={status} program={program} telegram={telegram} />

      <PlaybookSection
        link={link}
        copiedId={copiedId}
        fastReddit={fastReddit}
        onCopyLink={() => doCopy(link, 'Link', 'link-plain')}
        onCopyTemplate={copyTemplate}
        onCopyLinkWithUtm={copyLinkWithUtm}
      />

      <div className="lw-ref-toast" aria-live="polite">
        {toast}
      </div>
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function HeroSection({ user, link, code, share, program, copiedId, onCopyLink, onCopyCode, onSignup }) {
  const pitch = program?.memo?.pitch
    || 'Refer friends. Unlock lifetime tiers as signups roll in, and earn cash on every payment your referrals make.';

  return (
    <header className="lw-refpage-hero">
      <div className="lw-refpage-eyebrow">
        <Gift size={14} aria-hidden /> Referral program
      </div>
      <h1>
        Earn <GoldPremiumFx>free premium</GoldPremiumFx> <span className="lw-refpage-amp">+</span>{' '}
        <GoldPremiumFx>real cash</GoldPremiumFx> for sharing.
      </h1>
      <p className="lw-refpage-lede">{pitch}</p>

      <ul className="lw-refpage-perks">
        <li>
          <strong>3 / 15 / 30 signups</strong> auto-grant lifetime tier 1 / 2 / 3 — never expires.
        </li>
        <li>
          <strong>10% revshare</strong> on every payment your referrals make once you cross 10 signups,
          bumping to <strong>20%</strong> at 30.
        </li>
        <li>
          <strong>Manual payouts via Telegram</strong>, usually within 24 hours. No minimum threshold.
        </li>
      </ul>

      {user ? (
        <div className="lw-refpage-linkcard">
          <div className="lw-refpage-linkrow">
            <span className="lw-refpage-linklabel">Your link</span>
            <code className="lw-refpage-link" title={link}>
              {link}
            </code>
            <button type="button" className="lw-btn primary" onClick={onCopyLink}>
              <Copy size={14} aria-hidden /> {copiedId === 'link-plain' ? 'Copied!' : 'Copy link'}
            </button>
          </div>
          <div className="lw-refpage-coderow">
            <span className="lw-refpage-linklabel">Your code</span>
            <code className="lw-refpage-code" title={code}>
              {code}
            </code>
            <button type="button" className="lw-btn ghost" onClick={onCopyCode}>
              <Copy size={14} aria-hidden /> {copiedId === 'code' ? 'Copied!' : 'Copy code'}
            </button>
          </div>
          <div className="lw-refpage-share">
            <a className="lw-refpage-share-btn" href={share.redditPost} target="_blank" rel="noopener noreferrer">
              <span>Reddit</span>
              <span className="lw-refpage-share-sub">Submit post</span>
            </a>
            <a className="lw-refpage-share-btn" href={share.redditComment} target="_blank" rel="noopener noreferrer">
              <span>Reddit</span>
              <span className="lw-refpage-share-sub">Comment text</span>
            </a>
            <a className="lw-refpage-share-btn" href={share.xPost} target="_blank" rel="noopener noreferrer">
              <span>X / Twitter</span>
              <span className="lw-refpage-share-sub">New post</span>
            </a>
            <a className="lw-refpage-share-btn" href={share.telegram} target="_blank" rel="noopener noreferrer">
              <span>Telegram</span>
              <span className="lw-refpage-share-sub">Share</span>
            </a>
          </div>
        </div>
      ) : (
        <div className="lw-refpage-guest-cta">
          <button type="button" className="lw-btn primary lw-refpage-bigcta" onClick={onSignup}>
            Sign up free to get your link
          </button>
          <p className="lw-refpage-guest-note">
            Your unique link is generated the moment you sign up. No credit card, no commitment.
          </p>
        </div>
      )}
    </header>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function MetricsSection({ status, telegram, handle, savingHandle, onHandleChange, onSaveHandle }) {
  const count = Number(status?.count || 0);
  const earned = Number(status?.earnedCents || 0);
  const pending = Number(status?.pendingCents || 0);
  const rateLabel = status?.revshareUnlocked
    ? `${((status?.revshareRateBps || 0) / 100).toFixed(0)}%`
    : `Locked — unlocks at ${status?.revshareNextGoal || 10} signups`;

  return (
    <section className="lw-refpage-metrics" aria-label="Your referral metrics">
      <header className="lw-refpage-section-head">
        <h2>Your metrics</h2>
        <p>Live numbers — refreshed every time you open this page.</p>
      </header>

      <div className="lw-refpage-stats">
        <div className="lw-refpage-stat">
          <span>Verified signups</span>
          <strong>{count}</strong>
          <em>same-IP signups don't count</em>
        </div>
        <div className="lw-refpage-stat">
          <span>Lifetime tier earned</span>
          <strong>{status?.lifetimeTier ? status.lifetimeTier : '—'}</strong>
          <em>auto-granted at 3 / 15 / 30 signups</em>
        </div>
        <div className="lw-refpage-stat lw-refpage-stat--accent">
          <span>Revshare rate</span>
          <strong>{rateLabel}</strong>
          <em>10% at 10 signups, 20% at 30+</em>
        </div>
        <div className="lw-refpage-stat">
          <span>Total earned</span>
          <strong>${(earned / 100).toFixed(2)}</strong>
          <em>before payouts</em>
        </div>
        <div className="lw-refpage-stat lw-refpage-stat--accent">
          <span>Pending payout</span>
          <strong>${(pending / 100).toFixed(2)}</strong>
          <em>request via Telegram</em>
        </div>
      </div>

      <div className="lw-refpage-payout">
        <div className="lw-refpage-payout-copy">
          <h3>Request a payout</h3>
          <p>
            When you have a pending balance, DM us on Telegram with your username + Leak World handle.
            We verify and pay manually — usually within 24 hours.
          </p>
        </div>
        <div className="lw-refpage-payout-actions">
          <label className="lw-refpage-payout-handle">
            <span>Telegram handle (optional — speeds up matching)</span>
            <input
              type="text"
              placeholder="@yourname"
              value={handle}
              onChange={(e) => onHandleChange(e.target.value)}
              maxLength={64}
            />
          </label>
          <div className="lw-refpage-payout-buttons">
            <button
              type="button"
              className="lw-btn ghost"
              disabled={!handle.trim() || savingHandle}
              onClick={onSaveHandle}
            >
              {savingHandle ? 'Saving…' : 'Save handle'}
            </button>
            {telegram ? (
              <a className="lw-btn primary" href={telegram} target="_blank" rel="noopener noreferrer">
                Message us on Telegram
              </a>
            ) : (
              <span className="lw-refpage-payout-note">Telegram link coming soon.</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function GuestCallout({ onSignup }) {
  return (
    <section className="lw-refpage-guestcallout">
      <div>
        <h2>Sign up first — then earn.</h2>
        <p>
          Your link, your code, and your earnings dashboard all live inside your account. It's free,
          takes about 30 seconds, and your tier-1 perk is locked in after just 3 referrals.
        </p>
      </div>
      <button type="button" className="lw-btn primary lw-refpage-bigcta" onClick={onSignup}>
        Sign up free
      </button>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function HowItWorksSection({ status, program, telegram }) {
  const tiers = program?.tierLadder || [];
  const revshare = program?.revshareLadder || [];
  const count = Number(status?.count || 0);

  return (
    <section className="lw-refpage-section" aria-labelledby="lw-refpage-program-title">
      <header className="lw-refpage-section-head">
        <h2 id="lw-refpage-program-title">How the program works</h2>
        <p>Two parallel paths — every signup advances both at once.</p>
      </header>

      <div className="lw-refpage-paths">
        <article className="lw-refpage-path">
          <header>
            <span className="lw-refpage-path-badge">Path 1</span>
            <h3>Lifetime tier ladder</h3>
            <p>Verified signups via your link permanently grant you a paid plan.</p>
          </header>
          <ol className="lw-refpage-ladder">
            {tiers.map((step) => {
              const done = count >= step.threshold;
              const pct = Math.min(100, Math.round((count / Math.max(1, step.threshold)) * 100));
              return (
                <li key={step.tier} className={done ? 'is-done' : ''}>
                  <div className="lw-refpage-ladder-top">
                    <span className="lw-refpage-ladder-label">{step.label}</span>
                    <span className="lw-refpage-ladder-count">
                      {Math.min(count, step.threshold)} / {step.threshold}
                    </span>
                  </div>
                  <div className="lw-ref-bar" aria-hidden>
                    <div className="lw-ref-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="lw-refpage-ladder-detail">
                    Unlocks lifetime <strong>{step.tier}</strong> access at{' '}
                    <strong>{step.threshold}</strong> verified signups. Never expires, even if you stop
                    referring.
                  </p>
                </li>
              );
            })}
          </ol>
        </article>

        <article className="lw-refpage-path">
          <header>
            <span className="lw-refpage-path-badge lw-refpage-path-badge--cash">Path 2</span>
            <h3>Cash revshare</h3>
            <p>Earn a percentage of every payment your referrals make.</p>
          </header>
          <ol className="lw-refpage-ladder">
            {revshare.map((step) => {
              const done = count >= step.threshold;
              const pct = Math.min(100, Math.round((count / Math.max(1, step.threshold)) * 100));
              return (
                <li key={step.rateBps} className={done ? 'is-done' : ''}>
                  <div className="lw-refpage-ladder-top">
                    <span className="lw-refpage-ladder-label">{step.label}</span>
                    <span className="lw-refpage-ladder-count">
                      {Math.min(count, step.threshold)} / {step.threshold}
                    </span>
                  </div>
                  <div className="lw-ref-bar" aria-hidden>
                    <div className="lw-ref-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="lw-refpage-ladder-detail">
                    <strong>{(step.rateBps / 100).toFixed(0)}%</strong> of every payment your
                    referrals make from this point forward.
                  </p>
                </li>
              );
            })}
          </ol>
        </article>
      </div>

      <div className="lw-refpage-rules">
        <h3>The rules</h3>
        <ul>
          <li>
            Only <strong>verified</strong> signups count. Same-IP signups are flagged and don't count
            — prevents farming.
          </li>
          <li>
            Revshare accrues per payment. Pending balances stay pending until you request a payout.
          </li>
          <li>
            Payouts go out via Telegram only. We manually verify before paying to keep the program
            fair to everyone.
          </li>
          <li>
            We reserve the right to revoke rewards from bots / fraud. Be a good actor and you'll never
            hear from us.
          </li>
        </ul>
      </div>

      {telegram ? (
        <a className="lw-btn primary lw-refpage-section-cta" href={telegram} target="_blank" rel="noopener noreferrer">
          Message us on Telegram to claim a payout
        </a>
      ) : null}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function PlaybookSection({ link, copiedId, fastReddit, onCopyLink, onCopyTemplate, onCopyLinkWithUtm }) {
  return (
    <section className="lw-refpage-section" aria-labelledby="lw-refpage-fast-title">
      <header className="lw-refpage-section-head">
        <h2 id="lw-refpage-fast-title">
          <BookOpen size={18} aria-hidden /> How to get referrals fast
        </h2>
        <p>
          Reddit is the highest-converting source for this kind of content — also the fastest place to
          get shadowbanned. Follow the playbook below and your link survives long enough to convert.
        </p>
      </header>

      <div className="lw-refpage-twomin">
        <h3>The two-minute version</h3>
        <ol>
          <li>
            <strong>Comment, don't post.</strong> Posts get auto-removed; comments get read.
          </li>
          <li>
            <strong>Answer the question first.</strong> Drop your link as the answer, not as a sales
            pitch.
          </li>
          <li>
            <strong>One comment per sub per day.</strong> More than that and Reddit shadowbans you by
            tomorrow.
          </li>
          <li>
            <strong>Use the short link</strong> (<code>/r/YOURCODE</code>). It looks less affiliate-y
            than <code>?ref=YOURCODE</code>.
          </li>
        </ol>
        <div className="lw-refpage-twomin-actions">
          <a className="lw-btn primary" href={fastReddit} target="_blank" rel="noopener noreferrer">
            <Send size={14} aria-hidden /> Open active leak threads
            <ExternalLink size={14} aria-hidden />
          </a>
          <button type="button" className="lw-btn ghost" onClick={onCopyLink}>
            <Copy size={14} aria-hidden /> {copiedId === 'link-plain' ? 'Copied!' : 'Copy your link'}
          </button>
        </div>
      </div>

      <div className="lw-refpage-playbook-block">
        <h3>
          <Copy size={16} aria-hidden /> Post templates
        </h3>
        <p>
          Click any template to copy it with your link auto-inserted. Rotate templates so Reddit's
          spam filter doesn't flag you.
        </p>
        <div className="lw-guide-tpl-grid">
          {POST_TEMPLATES.map((t) => (
            <article key={t.id} className="lw-guide-tpl">
              <header>
                <h4>{t.label}</h4>
                <p>{t.use}</p>
              </header>
              <pre className="lw-guide-tpl-body">{String(t.body).replaceAll('{{link}}', link)}</pre>
              <button type="button" className="lw-btn primary" onClick={() => onCopyTemplate(t)}>
                {copiedId === t.id ? (
                  <>
                    <Check size={14} aria-hidden /> Copied!
                  </>
                ) : (
                  <>
                    <Copy size={14} aria-hidden /> Copy template
                  </>
                )}
              </button>
            </article>
          ))}
        </div>
      </div>

      <div className="lw-refpage-playbook-block">
        <h3>
          <ExternalLink size={16} aria-hidden /> Where to post
        </h3>
        <p>
          Verified-safe subreddits. <strong>Curated list</strong> — venues that don't auto-remove
          links and have active demand. Always re-check the sub's rules before posting.
        </p>
        <div className="lw-guide-subs">
          {SUBREDDITS.map((s) => (
            <a
              key={s.name}
              className="lw-guide-sub"
              href={`https://www.reddit.com/${s.name.replace(/^r\//, 'r/')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="lw-guide-sub-head">
                <strong>{s.name}</strong>
                <span className={`lw-guide-sub-mode mode-${s.mode}`}>
                  {s.mode === 'post' ? 'Post + comment' : 'Comment only'}
                </span>
              </div>
              <p>{s.notes}</p>
            </a>
          ))}
        </div>
      </div>

      <div className="lw-refpage-playbook-block">
        <h3>
          <Lightbulb size={16} aria-hidden /> Pro tips
        </h3>
        <ul className="lw-guide-tips">
          {TIPS.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      </div>

      <div className="lw-refpage-playbook-block">
        <h3>
          <ShieldAlert size={16} aria-hidden /> Tracking links (UTM)
        </h3>
        <p>
          UTM-tag your links if you want to see which platforms drive the most signups in the admin
          dashboard. Click any preset to copy your link with the UTM pre-attached.
        </p>
        <div className="lw-guide-utm-grid">
          {UTM_TEMPLATES.map((u) => (
            <button
              type="button"
              key={u.name}
              className="lw-guide-utm"
              onClick={() => onCopyLinkWithUtm(u.value)}
            >
              <span className="lw-guide-utm-name">{u.name}</span>
              <code className="lw-guide-utm-code">{u.value}</code>
              <span className="lw-guide-utm-action">
                {copiedId === `link-${u.value}` ? 'Copied!' : 'Copy link with UTM'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="lw-refpage-playbook-block lw-refpage-playbook-block--warning">
        <h3>
          <AlertTriangle size={16} aria-hidden /> Don't get banned
        </h3>
        <ul className="lw-guide-warnings">
          {WARNINGS.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
