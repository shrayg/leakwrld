/**
 * Shared hero heading for inner pages — thin display title + muted lede (Hanime rhythm).
 */
export function PageHero({ title, subtitle, children, className = '', align = 'center', titleAs: TitleTag = 'h1', titleId }) {
  const alignMod = align === 'start' ? 'hanime-page-hero--start' : '';
  return (
    <header className={`hanime-page-hero ${alignMod} ${className}`.trim()}>
      <TitleTag className="hanime-page-title" id={titleId}>
        {title}
      </TitleTag>
      {subtitle ? <p className="hanime-page-lede">{subtitle}</p> : null}
      {children}
    </header>
  );
}
