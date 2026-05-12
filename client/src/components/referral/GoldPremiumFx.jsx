/**
 * Gold-shimmer inline text — used to highlight "free premium", "earn money",
 * and other money-coded phrases. Pure CSS animation, no JS cost.
 */
export function GoldPremiumFx({ children, className = '' }) {
  return <span className={`lw-ref-gold ${className}`.trim()}>{children}</span>;
}
