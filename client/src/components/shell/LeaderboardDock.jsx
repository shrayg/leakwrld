import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export function LeaderboardDock({ inline = false }) {
  const periodWrapRef = useRef(null);
  const periodBtnRefs = useRef({});
  const [periodGlide, setPeriodGlide] = useState({
    opacity: 0,
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [tab, setTab] = useState('referrers');
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(() => (inline ? true : true));
  const [inlineVisible, setInlineVisible] = useState(true);

  useEffect(() => {
    if (inline && inlineVisible && !open) setOpen(true);
  }, [inline, inlineVisible, open]);

  const loadPage = useCallback(
    async (p) => {
      try {
        const url =
          tab === 'uploaders'
            ? '/api/upload/leaderboard?page=' + p
            : '/api/referral/leaderboard?page=' + p + '&period=weekly';
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) return;
        const data = await resp.json();
        setPage(data.page || 0);
        setTotalPages(data.totalPages || 1);
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      } catch {
        /* ignore */
      }
    },
    [tab],
  );

  useEffect(() => {
    loadPage(0);
  }, [tab, loadPage]);

  useLayoutEffect(() => {
    const wrap = periodWrapRef.current;
    const el = periodBtnRefs.current[tab];
    if (!wrap || !el) {
      setPeriodGlide((g) => ({ ...g, opacity: 0 }));
      return;
    }
    function measure() {
      const w = periodWrapRef.current;
      const node = periodBtnRefs.current[tab];
      if (!w || !node) return;
      const wr = w.getBoundingClientRect();
      const nr = node.getBoundingClientRect();
      setPeriodGlide({
        opacity: 1,
        left: nr.left - wr.left + w.scrollLeft,
        top: nr.top - wr.top + w.scrollTop,
        width: nr.width,
        height: nr.height,
      });
    }
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [tab]);

  function toggleOpen() {
    setOpen((v) => !v);
  }

  function closeInline() {
    setInlineVisible(false);
  }

  const title = tab === 'referrers' ? 'TOP 10 REFERRERS' : 'TOP 10 UPLOADERS';
  const subtitle =
    tab === 'referrers' ? '(Top 5 are paid out weekly)' : '(Most approved uploads)';
  const wrapperClass = 'leaderboard-wrapper' + (inline ? ' leaderboard-inline lb-open' : open ? ' lb-open' : ' lb-closed');

  if (inline && !inlineVisible) return null;

  const panelAndTab = (
    <>
      <div className="leaderboard-panel">
        <div className="leaderboard-widget" id="leaderboard-widget">
          <button
            type="button"
            className="leaderboard-mobile-close"
            aria-label="Close leaderboard"
            onClick={inline ? closeInline : toggleOpen}
          >
            <X size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <div className="leaderboard-title" id="lb-title">
            {title}
          </div>
          <div className="leaderboard-subtitle" id="lb-subtitle">
            {subtitle}
          </div>
          <div
            className="leaderboard-period"
            ref={periodWrapRef}
            role="group"
            aria-label="Leaderboard type"
          >
            <span
              className="leaderboard-period-glide"
              aria-hidden
              style={{
                opacity: periodGlide.opacity,
                transform: `translate(${periodGlide.left}px, ${periodGlide.top}px)`,
                width: periodGlide.width,
                height: periodGlide.height,
              }}
            />
            <button
              type="button"
              className={'leaderboard-period-btn leaderboard-period-btn--pill' + (tab === 'referrers' ? ' active' : '')}
              id="lb-period-weekly"
              ref={(node) => {
                if (node) periodBtnRefs.current.referrers = node;
                else delete periodBtnRefs.current.referrers;
              }}
              onClick={() => setTab('referrers')}
            >
              Referrers
            </button>
            <button
              type="button"
              className={'leaderboard-period-btn leaderboard-period-btn--pill' + (tab === 'uploaders' ? ' active' : '')}
              id="lb-period-all"
              ref={(node) => {
                if (node) periodBtnRefs.current.uploaders = node;
                else delete periodBtnRefs.current.uploaders;
              }}
              onClick={() => setTab('uploaders')}
            >
              Uploaders
            </button>
          </div>
          <ol className="leaderboard-list" id="leaderboard-list">
            {entries.length === 0 ? (
              <li style={{ justifyContent: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>No entries yet</li>
            ) : (
              entries.map((e) => (
                <li key={e.username + '-' + e.rank}>
                  <span className="lb-rank">#{e.rank}</span>
                  <span className="lb-name">{e.username}</span>
                  <span className="lb-count">{e.count}</span>
                </li>
              ))
            )}
          </ol>
          <div className="leaderboard-nav">
            <button className="leaderboard-arrow" id="lb-prev" type="button" aria-label="Previous page" disabled={page <= 0} onClick={() => loadPage(page - 1)}>
              ‹
            </button>
            <span className="leaderboard-page" id="lb-page">
              {page + 1} / {totalPages}
            </span>
            <button
              className="leaderboard-arrow"
              id="lb-next"
              type="button"
              aria-label="Next page"
              disabled={page >= totalPages - 1}
              onClick={() => loadPage(page + 1)}
            >
              ›
            </button>
          </div>
        </div>
      </div>
      {!inline && (
        <button
          className="leaderboard-tab"
          id="leaderboard-tab"
          type="button"
          aria-label="Toggle leaderboard"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <span className="leaderboard-tab-icon" id="leaderboard-tab-icon" aria-hidden>
            ‹
          </span>
        </button>
      )}
    </>
  );

  return (
    <div className={wrapperClass} id="leaderboard-wrapper">
      {inline ? panelAndTab : <div className="leaderboard-dock-track">{panelAndTab}</div>}
    </div>
  );
}
