import { useEffect, useState } from 'react';
import { fetchLiveActivity } from '../../api/client';

export function LiveActivityStrip() {
  const [watching, setWatching] = useState('—');
  const [today, setToday] = useState('—');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetchLiveActivity();
      if (cancelled) return;
      if (res.ok && res.data) {
        const w = Number(res.data.watchingNow || 0);
        const t = Number(res.data.videosAddedToday || 0);
        setWatching(w.toLocaleString());
        setToday(t.toLocaleString());
      }
    }
    load().catch(() => {});
    const id = setInterval(() => {
      load().catch(() => {});
    }, 30000);
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
