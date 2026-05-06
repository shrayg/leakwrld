/** Ported from script.js — same sort/dedupe behavior for folder grids. */

export function dedupeFiles(files) {
  const seenName = {};
  const seenTitle = {};
  return files.filter((f) => {
    if (seenName[f.name]) return false;
    seenName[f.name] = true;
    const title = f.name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s*\(\d+\)\s*/g, '')
      .replace(/\s*\[\d+\]\s*/g, '')
      .replace(/\s*copy\s*\d*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!title) return true;
    if (seenTitle[title]) return false;
    seenTitle[title] = true;
    return true;
  });
}

export function sortFiles(files, sortBy) {
  const pinnedName = 't7_rnd_747719429300';
  const pinned = [];
  const rest = [];
  files.forEach((f) => {
    if ((f.name || '').indexOf(pinnedName) !== -1) pinned.push(f);
    else rest.push(f);
  });
  if (sortBy === 'views') {
    rest.sort((a, b) => (b.views || 0) - (a.views || 0));
  } else if (sortBy === 'likes') {
    rest.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  } else if (sortBy === 'recent') {
    rest.sort((a, b) => {
      const da = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const db = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      return db - da;
    });
  } else if (sortBy === 'longest') {
    rest.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  } else if (sortBy === 'shortest') {
    rest.sort((a, b) => {
      const da = Number(a.duration);
      const db = Number(b.duration);
      const na = Number.isFinite(da) && da > 0 ? da : Number.MAX_SAFE_INTEGER;
      const nb = Number.isFinite(db) && db > 0 ? db : Number.MAX_SAFE_INTEGER;
      return na - nb;
    });
  }
  return pinned.concat(rest);
}

export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}
