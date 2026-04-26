const { test, expect } = require('@playwright/test');

/**
 * Drive the same listeners Shorts registers on `.shorts-feed-stage` (touch*, not pointer).
 * Playwright `dragTo` often maps to pointer/mouse and will not move the feed.
 */
async function touchSwipeOnStage(page, { y0Frac, y1Frac }) {
  await page.evaluate(
    ({ a, b }) => {
      const el = document.querySelector('.shorts-feed-stage');
      if (!el) throw new Error('shorts-feed-stage missing');
      const r = el.getBoundingClientRect();
      const x = r.left + r.width * 0.5;
      const y0 = r.top + r.height * a;
      const y1 = r.top + r.height * b;
      const touch = (y) =>
        new Touch({
          identifier: 0,
          target: el,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          radiusX: 2,
          radiusY: 2,
          rotationAngle: 0,
          force: 1,
        });
      el.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [touch(y0)],
          targetTouches: [touch(y0)],
          changedTouches: [touch(y0)],
        }),
      );
      el.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [touch(y1)],
          targetTouches: [touch(y1)],
          changedTouches: [touch(y1)],
        }),
      );
      el.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: [touch(y1)],
        }),
      );
    },
    { a: y0Frac, b: y1Frac },
  );
}

function transformIsAnimated(t) {
  return Boolean(t && t !== 'none' && (t.includes('matrix') || t.includes('translate')));
}

test.describe('Shorts mobile swipe', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('age_verified', 'true');
      } catch {
        /* ignore */
      }
    });
  });

  test('slide track transform animates on swipe-down (previous) after advancing once', async ({ page }) => {
    await page.goto('/shorts', { waitUntil: 'domcontentloaded' });
    await page.locator('.shorts-feed-stage').waitFor({ state: 'visible', timeout: 90000 });
    await page.locator('.shorts-slide-track').waitFor({ state: 'visible', timeout: 30000 });

    await touchSwipeOnStage(page, { y0Frac: 0.55, y1Frac: 0.28 });
    await page.waitForTimeout(1200);

    await page.evaluate(() => {
      window.__shortsTrackTransforms = [];
      window.__shortsTrackSampleInterval = window.setInterval(() => {
        const el = document.querySelector('.shorts-slide-track');
        if (!el) return;
        window.__shortsTrackTransforms.push(getComputedStyle(el).transform);
      }, 16);
    });

    await touchSwipeOnStage(page, { y0Frac: 0.35, y1Frac: 0.72 });

    await page.waitForTimeout(900);

    const transforms = await page.evaluate(() => {
      if (window.__shortsTrackSampleInterval) {
        window.clearInterval(window.__shortsTrackSampleInterval);
      }
      return window.__shortsTrackTransforms || [];
    });

    const animated = transforms.filter(transformIsAnimated);
    const uniqueAnimated = [...new Set(animated)];
    expect(
      uniqueAnimated.length,
      `expected matrix/translate samples during commit, got ${uniqueAnimated.length} (all: ${[...new Set(transforms)].slice(0, 6)})`,
    ).toBeGreaterThan(2);
  });

  test('slide track transform animates on swipe-up (next)', async ({ page }) => {
    await page.goto('/shorts', { waitUntil: 'domcontentloaded' });
    await page.locator('.shorts-feed-stage').waitFor({ state: 'visible', timeout: 90000 });
    await page.locator('.shorts-slide-track').waitFor({ state: 'visible', timeout: 30000 });

    await page.evaluate(() => {
      window.__shortsTrackTransforms = [];
      window.__shortsTrackSampleInterval = window.setInterval(() => {
        const el = document.querySelector('.shorts-slide-track');
        if (!el) return;
        window.__shortsTrackTransforms.push(getComputedStyle(el).transform);
      }, 16);
    });

    await touchSwipeOnStage(page, { y0Frac: 0.55, y1Frac: 0.28 });

    await page.waitForTimeout(900);

    const transforms = await page.evaluate(() => {
      if (window.__shortsTrackSampleInterval) {
        window.clearInterval(window.__shortsTrackSampleInterval);
      }
      return window.__shortsTrackTransforms || [];
    });

    const animated = transforms.filter(transformIsAnimated);
    expect([...new Set(animated)].length).toBeGreaterThan(2);
  });
});
