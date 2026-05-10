import { useCallback, useEffect, useRef } from 'react';
import {
  catalogMediaSession,
  catalogMediaWatchProgress,
  parseCatalogDurationSeconds,
} from '../lib/mediaAnalytics';

const TICK_MS = 4500;
/** Keep under server cap (120) and interval length so averages reflect visible dwell time. */
const TICK_DELTA_SEC = 4;
const KICK_MS = 3200;

/**
 * Measures in-viewport attention on catalog short cards (no inline player): starts a session when
 * the card is sufficiently visible and sends periodic `progress` pings so Media stats avg watch is non-zero.
 */
export function useCatalogShortTelemetry(item) {
  const rootRef = useRef(null);
  const playbackRef = useRef(null);
  const intervalRef = useRef(null);
  const kickRef = useRef(null);
  const visibleRef = useRef(false);

  const id = item?.id;
  const durationSec =
    item?.durationSeconds != null && item.durationSeconds !== ''
      ? Math.min(86400, Math.max(0, Number(item.durationSeconds) || 0))
      : parseCatalogDurationSeconds(item?.duration);

  useEffect(() => {
    playbackRef.current = null;
  }, [id]);

  const ensureSession = useCallback(() => {
    if (!id) return null;
    if (!playbackRef.current) {
      playbackRef.current = catalogMediaSession(id, { durationSeconds: durationSec });
    }
    return playbackRef.current;
  }, [id, durationSec]);

  const pulseProgress = useCallback(() => {
    const pb = playbackRef.current;
    if (!id || !pb) return;
    catalogMediaWatchProgress(id, pb, TICK_DELTA_SEC, durationSec);
  }, [id, durationSec]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !id) return;

    const stopTick = () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (kickRef.current != null) {
        clearTimeout(kickRef.current);
        kickRef.current = null;
      }
    };

    const startTick = () => {
      if (intervalRef.current != null) return;
      intervalRef.current = window.setInterval(() => {
        if (!visibleRef.current || document.visibilityState !== 'visible') return;
        pulseProgress();
      }, TICK_MS);
    };

    const io = new IntersectionObserver(
      ([e]) => {
        const on = e.isIntersecting && e.intersectionRatio >= 0.28;
        visibleRef.current = on;
        if (on) {
          ensureSession();
          kickRef.current = window.setTimeout(() => {
            kickRef.current = null;
            if (visibleRef.current && document.visibilityState === 'visible') pulseProgress();
          }, KICK_MS);
          startTick();
        } else {
          stopTick();
        }
      },
      { threshold: [0, 0.15, 0.28, 0.45, 0.65] },
    );

    io.observe(el);

    const onVis = () => {
      if (document.visibilityState === 'visible' && visibleRef.current) ensureSession();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      stopTick();
      visibleRef.current = false;
    };
  }, [id, ensureSession, pulseProgress]);

  const onNavigateIntent = useCallback(() => {
    ensureSession();
  }, [ensureSession]);

  return { rootRef, onNavigateIntent };
}
