import { useEffect, useState } from 'react';

/** Deterministic-but-wiggling fake counts — matches `initLiveActivity` in script.js */
export function LiveActivityStrip() {
  const [watching, setWatching] = useState('—');
  const [today, setToday] = useState('—');

  useEffect(() => {
    function seed() {
      const d = new Date();
      return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    }
    function hour() {
      return new Date().getHours();
    }
    function wiggle() {
      const h = hour();
      const curve = Math.cos(((h - 22) / 24) * 2 * Math.PI);
      const base = 180 + Math.round(curve * 90);
      const jitter = Math.floor(Math.random() * 35) - 17;
      return Math.max(60, base + jitter);
    }
    function todayCount() {
      const s = seed();
      const x = (s * 9301 + 49297) % 233280;
      return 18 + (x % 28);
    }

    setWatching(wiggle().toLocaleString());
    setToday(todayCount().toLocaleString());
    const id = setInterval(() => setWatching(wiggle().toLocaleString()), 12000);
    return () => clearInterval(id);
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
