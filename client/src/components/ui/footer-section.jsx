import React from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { CircleHelp, FrameIcon, Send, ShieldCheck } from 'lucide-react';

const footerLinks = [
  {
    label: 'Product',
    links: [
      { title: 'Categories', href: '/categories' },
      { title: 'Shorts', href: '/shorts' },
      { title: 'Upload', href: '/upload' },
      { title: 'Premium', href: '/checkout' },
    ],
  },
  {
    label: 'Company',
    links: [
      { title: 'FAQs', href: '/faqs' },
      { title: 'About Us', href: '/about' },
      { title: 'Privacy Policy', href: '/privacy' },
      { title: 'Terms of Service', href: '/terms' },
    ],
  },
  {
    label: 'Resources',
    links: [
      { title: 'Blog', href: '/blog' },
      { title: 'Changelog', href: '/changelog' },
      { title: 'Help', href: 'https://t.me/pornyardxyz', external: true },
    ],
  },
  {
    label: 'Social Links',
    links: [{ title: 'Telegram', href: 'https://t.me/pornyardxyz', icon: Send, external: true }],
  },
];

function FooterLinkItem({ link }) {
  const Icon = link.icon;
  const content = (
    <>
      {Icon ? <Icon className="footer-link-icon" /> : null}
      {link.title}
    </>
  );

  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className="footer-link-item">
        {content}
      </a>
    );
  }

  return (
    <Link to={link.href} className="footer-link-item">
      {content}
    </Link>
  );
}

function AnimatedContainer({ className, delay = 0.08, children }) {
  const shouldReduceMotion = useReducedMotion();
  if (shouldReduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ filter: 'blur(4px)', translateY: -8, opacity: 0 }}
      whileInView={{ filter: 'blur(0px)', translateY: 0, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.7 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function FooterSection() {
  return (
    <footer className="site-footer-upgraded" aria-label="Site footer">
      <div className="site-footer-upgraded__rail" />
      <div className="site-footer-upgraded__inner">
        <AnimatedContainer className="site-footer-upgraded__brand">
          <div className="site-footer-upgraded__brand-mark">
            <FrameIcon className="site-footer-upgraded__brand-icon" />
            <span>Pornyard</span>
          </div>
          <p className="site-footer-upgraded__copy">
            © {new Date().getFullYear()} Pornyard. Curated archive for Omegle-era wins, reaction clips, and creator
            uploads.
          </p>
          <div className="site-footer-upgraded__meta">
            <span>
              <ShieldCheck className="footer-link-icon" />
              18+ only
            </span>
            <span>
              <CircleHelp className="footer-link-icon" />
              Need support?{' '}
              <a href="https://t.me/pornyardxyz" target="_blank" rel="noopener noreferrer" className="site-footer-upgraded__meta-link">
                Telegram
              </a>
            </span>
          </div>
        </AnimatedContainer>

        <div className="site-footer-upgraded__columns">
          {footerLinks.map((section, idx) => (
            <AnimatedContainer key={section.label} className="site-footer-upgraded__column" delay={0.1 + idx * 0.08}>
              <h3 className="site-footer-upgraded__title">{section.label}</h3>
              <ul className="site-footer-upgraded__list">
                {section.links.map((link) => (
                  <li key={link.title}>
                    <FooterLinkItem link={link} />
                  </li>
                ))}
              </ul>
            </AnimatedContainer>
          ))}
        </div>
      </div>
    </footer>
  );
}
