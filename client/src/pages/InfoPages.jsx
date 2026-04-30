import { Link } from 'react-router-dom';
import { PageHero } from '../components/layout/PageHero';

function InfoPage({ title, subtitle, sections }) {
  return (
    <main className="page-content pornwrld-info-route">
      <div className="info-page pornwrld-info-page">
        <PageHero title={title} subtitle={subtitle} />
        <div className="info-page__content">
          {sections.map((s) => (
            <section key={s.heading} className="info-page__section">
              <h2>{s.heading}</h2>
              {s.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </section>
          ))}
        </div>
        <div className="info-page__footer">
          <Link to="/">Back to homepage</Link>
        </div>
      </div>
    </main>
  );
}

export function AboutPage() {
  return (
    <InfoPage
      title="About Pornwrld"
      subtitle="A modern archive for cam reactions, creator uploads, and curated viral wins."
      sections={[
        {
          heading: 'What we do',
          paragraphs: [
            'Pornwrld organizes category-based clips across Omegle-era reactions, TikTok, Snapchat, and custom uploads into a cleaner browsing experience with previews and unlocked tiers.',
            'Our focus is fast discovery, strong thumbnail coverage, and a mobile-first layout that keeps the content readable and watchable.',
          ],
        },
        {
          heading: 'How access works',
          paragraphs: [
            'Guests can browse previews. Logged-in users can unlock broader access through referral and premium flows.',
            'Tier upgrades and key redemption are integrated into account tools and checkout.',
          ],
        },
      ]}
    />
  );
}

export function FaqsPage() {
  return (
    <InfoPage
      title="FAQs"
      subtitle="Quick answers to the most common account and access questions."
      sections={[
        {
          heading: 'Do I need an account?',
          paragraphs: [
            'You can view limited previews without an account. Account creation unlocks profile features and referral tracking.',
          ],
        },
        {
          heading: 'How do I upgrade?',
          paragraphs: [
            'Use Premium checkout from the site, or follow the referral program in your profile to unlock higher tiers.',
          ],
        },
        {
          heading: 'Where can I get support?',
          paragraphs: [
            'Use the Help center (/help) for troubleshooting. For anything else — billing, technical issues, video reports, or DMCA/takedowns — contact us only through our official Discord (discord.gg/pornwrld) or Telegram (t.me/pornwrldxyz). Those are the only channels we use.',
          ],
        },
      ]}
    />
  );
}

export function PrivacyPage() {
  return (
    <InfoPage
      title="Privacy Policy"
      subtitle="How we collect and use data to operate the platform."
      sections={[
        {
          heading: 'Data we collect',
          paragraphs: [
            'We collect account details, authentication/session data, and usage analytics required to run features such as recommendations, shorts stats, and access control.',
            'Payment verification and redemption metadata may be processed to grant tier access.',
          ],
        },
        {
          heading: 'How data is used',
          paragraphs: [
            'Data is used for security, moderation, feature analytics, and account functionality.',
            'We do not sell personal data. Third-party processors are used only where required for core platform services.',
          ],
        },
      ]}
    />
  );
}

export function TermsPage() {
  return (
    <InfoPage
      title="Terms of Service"
      subtitle="Rules for using Pornwrld."
      sections={[
        {
          heading: 'Eligibility',
          paragraphs: ['You must be at least 18 years old and legally permitted to access adult material in your location.'],
        },
        {
          heading: 'Acceptable use',
          paragraphs: [
            'Do not redistribute, scrape, re-host, or attempt to bypass access controls.',
            'Abuse, harassment, fraud, and unauthorized account access are prohibited.',
          ],
        },
        {
          heading: 'Content policy and takedowns',
          paragraphs: ['We review legitimate takedown requests and remove content when required by law and policy.'],
        },
      ]}
    />
  );
}

export function HelpPage() {
  return (
    <InfoPage
      title="Help Center"
      subtitle="Troubleshooting for login, playback, upload, and billing."
      sections={[
        {
          heading: 'Playback issues',
          paragraphs: [
            'Refresh the page, check your connection, and ensure ad/script blockers are not blocking media routes.',
            'If thumbnails or videos fail repeatedly, try clearing cache and service worker data before retrying.',
          ],
        },
        {
          heading: 'Account and billing',
          paragraphs: [
            'If premium access did not update after payment or key redemption, log out/in once and check your tier badge.',
            'For unresolved billing cases, message us on Discord or Telegram with your username and transaction details — those are our only official support channels.',
          ],
        },
      ]}
    />
  );
}

export function ChangelogPage() {
  return (
    <InfoPage
      title="Changelog"
      subtitle="Recent platform updates."
      sections={[
        {
          heading: 'Theme refresh and layout',
          paragraphs: ['Updated navigation, upgraded footer, and improved responsive spacing across core pages.'],
        },
        {
          heading: 'Data and media reliability',
          paragraphs: ['Split analytics persistence into live/history snapshots and improved R2-backed loading behavior.'],
        },
      ]}
    />
  );
}

export function BrandPage() {
  return (
    <InfoPage
      title="Brand"
      subtitle="Basic logo and naming guidance."
      sections={[
        {
          heading: 'Brand name',
          paragraphs: ['Use “Pornwrld” as one word with standard capitalization.'],
        },
        {
          heading: 'Visual style',
          paragraphs: [
            'Primary visual language: dark backgrounds, warm highlight tones, and compact media-first layouts.',
            'Avoid stretching logos or using low-contrast text on media thumbnails.',
          ],
        },
      ]}
    />
  );
}
