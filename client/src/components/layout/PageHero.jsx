/**
 * Shared hero heading for inner pages — thin display title + muted lede (Pornwrld rhythm).
 */
export function PageHero({ title, subtitle, children, className = '', align = 'center', titleAs: TitleTag = 'h1', titleId }) {
  const alignCls = align === 'start' ? 'mx-0 max-w-none text-left' : 'mx-auto max-w-[920px] text-center';
  return (
    <header className={`${alignCls} mb-[clamp(20px,4vw,36px)] ${className}`.trim()}>
      <TitleTag
        className="mb-2 text-[clamp(2rem,4vw,3rem)] font-light leading-[1.15] tracking-[0.02em] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.45)]"
        id={titleId}
      >
        {title}
      </TitleTag>
      {subtitle ? (
        <p
          className={`text-[clamp(13px,1.35vw,15px)] font-normal leading-[1.55] tracking-[0.02em] text-text-muted ${
            align === 'start' ? 'mx-0 max-w-[34em]' : 'mx-auto max-w-[34em]'
          }`}
        >
          {subtitle}
        </p>
      ) : null}
      {children}
    </header>
  );
}
