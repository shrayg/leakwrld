import { useEffect, useRef, useState } from 'react';

function fmtTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

/**
 * Mirrors video.html initVideoPagePlayer — custom controls, fullscreen, codec fallback.
 */
export function CustomVideoPlayer({ mediaSrc, previewSrc, folder, name, subfolder, onFirstPlay, onProgress }) {
  const cpRef = useRef(null);
  const vidRef = useRef(null);
  const isSeekingRef = useRef(false);
  const retriesRef = useRef(0);
  const codecCheckedRef = useRef(false);
  const previewModeRef = useRef(false);
  const controlsTimerRef = useRef(null);
  const savedScrollYRef = useRef(0);
  const viewRecordedRef = useRef(false);
  const lastProgressSentRef = useRef(0);

  const [paused, setPaused] = useState(true);
  const [timeLabel, setTimeLabel] = useState('0:00 / 0:00');
  const [rangeVal, setRangeVal] = useState(0);
  const [bufferPct, setBufferPct] = useState(0);
  const [vol, setVol] = useState(100);
  const [nativeFs, setNativeFs] = useState(false);
  const [cssFs, setCssFs] = useState(false);
  const [fillPct, setFillPct] = useState(0);

  useEffect(() => {
    const vid = vidRef.current;
    const cp = cpRef.current;
    if (!vid || !cp) return;

    retriesRef.current = 0;
    previewModeRef.current = false;
    codecCheckedRef.current = false;
    viewRecordedRef.current = false;
    vid.src = mediaSrc;

    function syncPause() {
      setPaused(vid.paused);
    }

    function onPlayOnce() {
      if (viewRecordedRef.current) return;
      viewRecordedRef.current = true;
      if (typeof onFirstPlay === 'function') onFirstPlay();
    }

    function onTime() {
      if (isSeekingRef.current) return;
      const dur = vid.duration || 0;
      const cur = vid.currentTime || 0;
      setTimeLabel(fmtTime(cur) + ' / ' + fmtTime(dur));
      if (dur > 0) {
        setRangeVal(Math.round((cur / dur) * 1000));
        setFillPct((cur / dur) * 100);
        if (typeof onProgress === 'function') {
          const now = Date.now();
          if (now - lastProgressSentRef.current > 5000) {
            lastProgressSentRef.current = now;
            onProgress({
              positionSec: cur,
              durationSec: dur,
              percentWatched: (cur / dur) * 100,
              completed: (cur / dur) >= 0.95,
              watchMs: 5000,
            });
          }
        }
      }
    }

    function onProgress() {
      if (vid.buffered.length > 0) {
        const buffEnd = vid.buffered.end(vid.buffered.length - 1);
        const dur = vid.duration || 1;
        setBufferPct((buffEnd / dur) * 100);
      }
    }

    function onError() {
      if (retriesRef.current >= 2) return;
      retriesRef.current++;
      if (!previewModeRef.current && retriesRef.current === 1) {
        vid.src = previewSrc;
        vid.load();
        previewModeRef.current = true;
        return;
      }
      const fresh = vid.src + (vid.src.indexOf('?') >= 0 ? '&' : '?') + '_r=' + Date.now();
      vid.src = fresh;
      vid.load();
    }

    function onLoadedDataCodec() {
      if (codecCheckedRef.current) return;
      codecCheckedRef.current = true;
      if (vid.videoWidth === 0 && vid.duration > 0 && folder && name) {
        let transcodeUrl =
          '/preview-transcode?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(name);
        if (subfolder) transcodeUrl += '&subfolder=' + encodeURIComponent(subfolder);
        const t = vid.currentTime;
        vid.src = transcodeUrl;
        vid.load();
        vid.addEventListener(
          'loadeddata',
          () => {
            try {
              vid.currentTime = t;
            } catch {}
          },
          { once: true }
        );
      }
    }

    function togglePlay() {
      if (vid.paused) vid.play().catch(() => {});
      else vid.pause();
    }

    function toggleFullscreen() {
      const isNativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (cp.classList.contains('cp-fullscreen') || document.body.classList.contains('cp-fs-active')) {
        setCssFs(false);
        cp.classList.remove('cp-fullscreen');
        document.documentElement.classList.remove('cp-fs-active');
        document.body.classList.remove('cp-fs-active');
        document.body.style.top = '';
        window.scrollTo(0, savedScrollYRef.current);
        return;
      }
      if (isNativeFs) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && vid.webkitEnterFullscreen) {
        vid.webkitEnterFullscreen();
        return;
      }
      if (cp.requestFullscreen) {
        cp.requestFullscreen().catch(() => {
          savedScrollYRef.current = window.scrollY;
          setCssFs(true);
          cp.classList.add('cp-fullscreen');
          document.documentElement.classList.add('cp-fs-active');
          document.body.classList.add('cp-fs-active');
          document.body.style.top = -savedScrollYRef.current + 'px';
        });
      } else if (cp.webkitRequestFullscreen) {
        cp.webkitRequestFullscreen();
      } else {
        savedScrollYRef.current = window.scrollY;
        setCssFs(true);
        cp.classList.add('cp-fullscreen');
        document.documentElement.classList.add('cp-fs-active');
        document.body.classList.add('cp-fs-active');
        document.body.style.top = -savedScrollYRef.current + 'px';
      }
    }

    function showControls() {
      cp.classList.remove('cp-controls-hidden');
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = setTimeout(() => {
        if (!vid.paused) cp.classList.add('cp-controls-hidden');
      }, 3000);
    }

    const onFsChange = () => {
      setNativeFs(!!(document.fullscreenElement || document.webkitFullscreenElement));
    };

    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        vid.currentTime = Math.max(0, vid.currentTime - 5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5);
      } else if (e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm') {
        e.preventDefault();
        vid.muted = !vid.muted;
        setVol(vid.muted ? 0 : Math.round(vid.volume * 100));
      }
    };

    const onPop = () => {
      if (cp.classList.contains('cp-fullscreen')) toggleFullscreen();
    };

    vid.addEventListener('play', syncPause);
    vid.addEventListener('play', onPlayOnce);
    vid.addEventListener('pause', syncPause);
    vid.addEventListener('loadeddata', syncPause);
    vid.addEventListener('timeupdate', onTime);
    vid.addEventListener('progress', onProgress);
    vid.addEventListener('error', onError);
    vid.addEventListener('loadeddata', onLoadedDataCodec);
    cp.addEventListener('mousemove', showControls);
    cp.addEventListener('touchstart', showControls);
    document.addEventListener('fullscreenchange', onFsChange);
    cp.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);

    return () => {
      vid.removeEventListener('play', syncPause);
      vid.removeEventListener('play', onPlayOnce);
      vid.removeEventListener('pause', syncPause);
      vid.removeEventListener('loadeddata', syncPause);
      vid.removeEventListener('timeupdate', onTime);
      vid.removeEventListener('progress', onProgress);
      vid.removeEventListener('error', onError);
      vid.removeEventListener('loadeddata', onLoadedDataCodec);
      cp.removeEventListener('mousemove', showControls);
      cp.removeEventListener('touchstart', showControls);
      document.removeEventListener('fullscreenchange', onFsChange);
      cp.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      clearTimeout(controlsTimerRef.current);
    };
  }, [mediaSrc, previewSrc, folder, name, subfolder, onFirstPlay, onProgress]);

  return (
    <div
      ref={cpRef}
      className="custom-player video-page-custom-player"
      tabIndex={0}
      role="region"
      aria-label="Video player"
      onClick={(e) => {
        const vid = vidRef.current;
        if (!vid) return;
        if (e.target === vid || (e.target.closest && e.target.closest('.cp-overlay-play'))) {
          if (vid.paused) vid.play().catch(() => {});
          else vid.pause();
        }
      }}
      onDoubleClick={(e) => {
        if (e.target === vidRef.current || e.target.closest('.custom-player')) {
          const vid = vidRef.current;
          const cp = cpRef.current;
          if (!vid || !cp) return;
          const isNativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
          if (cssFs) {
            setCssFs(false);
            cp.classList.remove('cp-fullscreen');
            document.documentElement.classList.remove('cp-fs-active');
            document.body.classList.remove('cp-fs-active');
            document.body.style.top = '';
            window.scrollTo(0, savedScrollYRef.current);
            return;
          }
          if (isNativeFs) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            return;
          }
          if (cp.requestFullscreen) {
            cp.requestFullscreen().catch(() => {
              savedScrollYRef.current = window.scrollY;
              setCssFs(true);
              cp.classList.add('cp-fullscreen');
              document.documentElement.classList.add('cp-fs-active');
              document.body.classList.add('cp-fs-active');
              document.body.style.top = -savedScrollYRef.current + 'px';
            });
          }
        }
      }}
    >
      <video ref={vidRef} className="video-page-video" preload="auto" autoPlay muted playsInline />
      <div className={`cp-overlay cp-overlay-play ${!paused ? 'cp-hidden' : ''}`}>
        <button
          type="button"
          className="cp-big-play"
          aria-label="Play"
          onClick={(e) => {
            e.stopPropagation();
            const v = vidRef.current;
            if (!v) return;
            if (v.paused) v.play().catch(() => {});
            else v.pause();
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
      <div className="cp-controls">
        <button
          type="button"
          className="cp-btn cp-play-btn"
          aria-label="Play/Pause"
          onClick={(e) => {
            e.stopPropagation();
            const v = vidRef.current;
            if (!v) return;
            if (v.paused) v.play().catch(() => {});
            else v.pause();
          }}
        >
          <svg className="cp-icon-play" viewBox="0 0 24 24" fill="currentColor" style={{ display: paused ? '' : 'none' }}>
            <path d="M8 5v14l11-7z" />
          </svg>
          <svg className="cp-icon-pause" viewBox="0 0 24 24" fill="currentColor" style={{ display: paused ? 'none' : '' }}>
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        </button>
        <span className="cp-time">{timeLabel}</span>
        <div className="cp-progress-wrap">
          <div className="cp-progress-bar">
            <div className="cp-progress-buffered" style={{ width: bufferPct + '%' }} />
            <div className="cp-progress-filled" style={{ width: fillPct + '%' }} />
          </div>
          <input
            className="cp-progress-input"
            type="range"
            min={0}
            max={1000}
            value={rangeVal}
            aria-label="Seek"
            onMouseDown={() => {
              isSeekingRef.current = true;
            }}
            onTouchStart={() => {
              isSeekingRef.current = true;
            }}
            onInput={(e) => {
              const v = vidRef.current;
              if (!v) return;
              const dur = v.duration || 0;
              const t = (Number(e.target.value) / 1000) * dur;
              setRangeVal(Number(e.target.value));
              if (dur > 0) setFillPct((t / dur) * 100);
            }}
            onChange={(e) => {
              const v = vidRef.current;
              if (!v) return;
              const dur = v.duration || 0;
              v.currentTime = (Number(e.target.value) / 1000) * dur;
              isSeekingRef.current = false;
            }}
          />
        </div>
        <button
          type="button"
          className="cp-btn cp-vol-btn"
          aria-label="Mute/Unmute"
          onClick={(e) => {
            e.stopPropagation();
            const v = vidRef.current;
            if (!v) return;
            v.muted = !v.muted;
            if (!v.muted && v.volume === 0) {
              v.volume = 0.5;
              setVol(50);
            } else setVol(v.muted ? 0 : Math.round(v.volume * 100));
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          </svg>
        </button>
        <input
          className="cp-vol-slider"
          type="range"
          min={0}
          max={100}
          value={vol}
          aria-label="Volume"
          onChange={(e) => {
            const v = vidRef.current;
            if (!v) return;
            const n = Number(e.target.value);
            v.volume = n / 100;
            v.muted = n === 0;
            setVol(n);
          }}
        />
        <button
          type="button"
          className="cp-btn cp-fs-btn"
          aria-label="Fullscreen"
          onClick={(e) => {
            e.stopPropagation();
            const vid = vidRef.current;
            const cp = cpRef.current;
            if (!vid || !cp) return;
            const isNativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
            if (cssFs) {
              setCssFs(false);
              cp.classList.remove('cp-fullscreen');
              document.documentElement.classList.remove('cp-fs-active');
              document.body.classList.remove('cp-fs-active');
              document.body.style.top = '';
              window.scrollTo(0, savedScrollYRef.current);
              return;
            }
            if (isNativeFs) {
              (document.exitFullscreen || document.webkitExitFullscreen).call(document);
              return;
            }
            if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && vid.webkitEnterFullscreen) {
              vid.webkitEnterFullscreen();
              return;
            }
            if (cp.requestFullscreen) {
              cp.requestFullscreen().catch(() => {
                savedScrollYRef.current = window.scrollY;
                setCssFs(true);
                cp.classList.add('cp-fullscreen');
                document.documentElement.classList.add('cp-fs-active');
                document.body.classList.add('cp-fs-active');
                document.body.style.top = -savedScrollYRef.current + 'px';
              });
            } else if (cp.webkitRequestFullscreen) {
              cp.webkitRequestFullscreen();
            } else {
              savedScrollYRef.current = window.scrollY;
              setCssFs(true);
              cp.classList.add('cp-fullscreen');
              document.documentElement.classList.add('cp-fs-active');
              document.body.classList.add('cp-fs-active');
              document.body.style.top = -savedScrollYRef.current + 'px';
            }
          }}
        >
          <svg className="cp-icon-fs-enter" viewBox="0 0 24 24" fill="currentColor" style={{ display: nativeFs || cssFs ? 'none' : '' }}>
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
          </svg>
          <svg className="cp-icon-fs-exit" viewBox="0 0 24 24" fill="currentColor" style={{ display: nativeFs || cssFs ? '' : 'none' }}>
            <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
