import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Glide indicator + `.pw-nav-tab` buttons matching main `TopNavModern` tabs.
 * @param {{ activeKey: string, tabs: { key: string, label: string }[], onChange: (key: string) => void, className?: string, glideClassName?: string, ariaLabel?: string, sentenceCase?: boolean }} props
 */
export function PwNavTabRow({
  activeKey,
  tabs,
  onChange,
  className = '',
  glideClassName = '',
  ariaLabel = 'Tabs',
  sentenceCase = false,
}) {
  const navRef = useRef(null);
  const itemRefs = useRef({});
  const [glide, setGlide] = useState({ opacity: 0, x: 0, y: 0, w: 0, h: 0 });
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    function onResize() {
      setResizeTick((t) => t + 1);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const navNode = navRef.current;
    const activeNode = itemRefs.current[activeKey];
    if (!navNode || !activeNode) {
      setGlide((p) => ({ ...p, opacity: 0 }));
      return;
    }
    const nr = navNode.getBoundingClientRect();
    const ar = activeNode.getBoundingClientRect();
    setGlide({
      opacity: 1,
      x: ar.left - nr.left + navNode.scrollLeft,
      y: ar.top - nr.top + navNode.scrollTop,
      w: ar.width,
      h: ar.height,
    });
  }, [activeKey, tabs, resizeTick]);

  const navCls = ['pw-nav-tabs', sentenceCase ? 'pw-nav-tab-row--sentence' : '', className].filter(Boolean).join(' ');
  const glideCls = ['pw-nav-glide', glideClassName].filter(Boolean).join(' ');

  return (
    <nav
      ref={navRef}
      className={navCls}
      role="tablist"
      aria-label={ariaLabel}
      style={{ position: 'relative', isolation: 'isolate' }}
    >
      <span
        className={glideCls}
        style={{
          opacity: glide.opacity,
          transform: `translate(${glide.x}px, ${glide.y}px)`,
          width: glide.w,
          height: glide.h,
          pointerEvents: 'none',
          zIndex: 0,
        }}
        aria-hidden="true"
      />
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={activeKey === key}
          className={`pw-nav-tab${activeKey === key ? ' active' : ''}`}
          ref={(node) => {
            if (node) itemRefs.current[key] = node;
            else delete itemRefs.current[key];
          }}
          onClick={() => onChange(key)}
          style={{ position: 'relative', zIndex: 1, pointerEvents: 'auto' }}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
