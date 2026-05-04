import { useState } from 'react';
import { X } from 'lucide-react';
import { OFFICIAL_DISCORD_INVITE_URL, OFFICIAL_TELEGRAM_URL } from '../../constants/officialContact';

export function TosDmcaFooter() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="tos-dmca-link" id="tos-dmca-link" type="button" onClick={() => setOpen(true)}>
        Tos &amp; DMCA policy
      </button>

      {open && (
        <div className="tos-dmca-overlay active" id="tos-dmca-overlay" aria-hidden="false" role="presentation" style={{ display: 'flex' }} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="tos-dmca-modal" role="dialog" aria-modal="true" aria-labelledby="tos-dmca-title" onClick={(e) => e.stopPropagation()}>
            <button className="tos-dmca-close" id="tos-dmca-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>
              <X size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <h2 id="tos-dmca-title">TOS &amp; DMCA Policy</h2>
            <p className="tos-dmca-sub">By accessing this site, you agree to the terms below.</p>
            <div className="tos-dmca-body">
              <p>
                <strong>Terms of Service</strong>: You must be 18+ and legally allowed to view adult content in your location. Do not redistribute, record, or resell content from this site. Abuse, harassment, or attempts to bypass access controls are prohibited.
              </p>
              <p>
                <strong>DMCA</strong>: If you believe content infringes your copyright, submit a notice to the site operator with: (1) your contact info, (2) the specific URL(s), (3) a good‑faith statement, and (4) a statement under penalty of perjury that you are authorized to act, plus your physical or electronic signature. We will act on valid notices promptly.
              </p>
              <p>
                <strong>Where to reach us</strong>: Discord and Telegram are our <strong>only</strong> official channels for DMCA notices, takedowns, abuse reports, and general issues —{' '}
                <a href={OFFICIAL_DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
                  discord.gg/pornwrld
                </a>{' '}
                ·{' '}
                <a href={OFFICIAL_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                  t.me/pornwrldsupport
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
