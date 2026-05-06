import { useEffect, useState } from 'react';
import { fetchLiveActivity } from '../../api/client';

const WATCHING_BASE = 127;
const FAKE_TODAY_MIN = 173;
const FAKE_TODAY_MAX = 312;

function pickFakeVideosAddedToday() {
  const span = FAKE_TODAY_MAX - FAKE_TODAY_MIN + 1;
  return FAKE_TODAY_MIN + Math.floor(Math.random() * span);
}

export function LiveActivityStrip() {
  const [watching, setWatching] = useState(() => WATCHING_BASE.toLocaleString());
  const [today] = useState(() => pickFakeVideosAddedToday().toLocaleString());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetchLiveActivity();
        if (cancelled) return;
        const raw =
          res.ok && res.data != null ? Number(res.data.watchingNow ?? NaN) : NaN;
        const active = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
        setWatching((WATCHING_BASE + active).toLocaleString());
      } catch {
        if (!cancelled) setWatching(WATCHING_BASE.toLocaleString());
      }
    }
    load();
    const id = setInterval(() => load().catch(() => {}), 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="live-activity" id="live-activity" aria-label="Live activity">
      <span className="live-dot" aria-hidden="true" />
      <span className="live-activity-text">
        <strong id="live-watching">{watching}</strong> watching now · <strong id="live-today">{today}</strong> videos added today
      </span>
    </div>
  );
}
