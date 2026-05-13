/**
 * Brand SVG marks for referral share surfaces.
 * Lucide (used like shadcn) does not ship Reddit / X logos — small inline SVGs
 * keep bundle weight low vs pulling simple-icons for two paths.
 */

/** Reddit "Snoo" on brand orange — matches prior ReferralModals inline mark. */
export function RedditMark({ size = 22, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="16" fill="#FF4500" />
      <path
        fill="#fff"
        d="M26 16.2c0-1.2-1-2.2-2.2-2.2-.6 0-1.1.2-1.5.6-1.5-1-3.4-1.6-5.5-1.7l1.1-3.5 3 .7c0 .9.7 1.6 1.6 1.6.9 0 1.6-.7 1.6-1.6 0-.9-.7-1.6-1.6-1.6-.6 0-1.2.4-1.5.9l-3.4-.8c-.2 0-.4.1-.5.3l-1.3 4.1c-2.1.1-4.1.7-5.5 1.7-.4-.4-.9-.6-1.5-.6-1.2 0-2.2 1-2.2 2.2 0 .8.4 1.5 1.1 1.9 0 .2 0 .4 0 .6 0 3 3.7 5.5 8.3 5.5s8.3-2.5 8.3-5.5c0-.2 0-.4 0-.6.7-.4 1.2-1.1 1.2-1.9zM10.5 17.7c0-.9.7-1.6 1.6-1.6.9 0 1.6.7 1.6 1.6 0 .9-.7 1.6-1.6 1.6-.9 0-1.6-.7-1.6-1.6zm9.1 4.3c-1 1-3 1.1-3.6 1.1s-2.6-.1-3.6-1.1c-.2-.2-.2-.4 0-.6.2-.2.4-.2.6 0 .6.6 2 .9 3 .9s2.4-.2 3-.9c.2-.2.4-.2.6 0 .2.2.2.4 0 .6zm-.2-2.8c-.9 0-1.6-.7-1.6-1.6 0-.9.7-1.6 1.6-1.6.9 0 1.6.7 1.6 1.6 0 .9-.7 1.6-1.6 1.6z"
      />
    </svg>
  );
}

/** X (Twitter) logomark — inherits `color` from parent for dark/light surfaces. */
export function XMark({ size = 22, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}
