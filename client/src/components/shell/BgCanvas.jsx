import { useEffect, useRef } from 'react';

/** Particle network background — same logic as script.js initBackground(). */
export function BgCanvas() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w;
    let h;
    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const PARTICLE_COUNT = 35;
    const CONN_DIST = 120;
    const CONN_DIST_SQ = CONN_DIST * CONN_DIST;
    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5,
        color:
          Math.random() > 0.5
            ? `rgba(124, 58, 237, ${Math.random() * 0.4 + 0.1})`
            : `rgba(255, 77, 109, ${Math.random() * 0.3 + 0.05})`,
      });
    }

    let bgPaused = false;
    let bgVisible = true;
    let lastFrame = 0;
    let raf = 0;

    document.addEventListener('visibilitychange', onVis);
    function onVis() {
      bgPaused = document.hidden;
      if (!bgPaused && bgVisible) raf = requestAnimationFrame(draw);
    }

    let observer;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        bgVisible = entries[0]?.isIntersecting ?? true;
        if (bgVisible && !bgPaused) raf = requestAnimationFrame(draw);
      });
      observer.observe(canvas);
    }

    function draw(ts) {
      if (bgPaused || !bgVisible) return;
      if (ts - lastFrame < 32) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastFrame = ts;

      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.04)';
      ctx.lineWidth = 0.5;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          if (dx * dx + dy * dy < CONN_DIST_SQ) {
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
          }
        }
      }
      ctx.stroke();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      if (observer) observer.disconnect();
    };
  }, []);

  return <canvas id="bg-canvas" ref={ref} aria-hidden="true" />;
}
