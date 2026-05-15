'use strict';

const fs = require('fs');
const path = require('path');
const { rowIdFromStorageKey } = require('./mediaAnalytics');

function thumbFileName(storageKey) {
  return `${rowIdFromStorageKey(storageKey)}.webp`;
}

/**
 * @param {string} storageKey R2 object key
 * @param {string} thumbCacheDir absolute path to data/thumb-cache
 * @param {string|null|undefined} thumbPathFromDb basename from catalog_shorts.thumb_path
 * @returns {string|null} e.g. /cache/thumbs/m_abc.webp
 */
function thumbUrlForKey(storageKey, thumbCacheDir, thumbPathFromDb = null) {
  const candidates = [];
  if (thumbPathFromDb) candidates.push(String(thumbPathFromDb).trim());
  if (storageKey) candidates.push(thumbFileName(storageKey));
  const seen = new Set();
  for (const name of candidates) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (!/^[a-zA-Z0-9._-]+\.webp$/i.test(name)) continue;
    try {
      const fp = path.join(thumbCacheDir, name);
      if (fs.statSync(fp).size > 32) return `/cache/thumbs/${name}`;
    } catch {
      /* missing */
    }
  }
  return null;
}

module.exports = {
  thumbUrlForKey,
  thumbFileName,
};
