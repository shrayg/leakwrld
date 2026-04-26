/** Display count for category tiles — matches `initFolderCounts` / `_display` in script.js */
export function displayFolderCountLabel(folderName, rawCount) {
  if (typeof rawCount !== 'number' || rawCount <= 0) return null;
  let salt = 0;
  const name = String(folderName || '');
  for (let i = 0; i < name.length; i++) salt = (salt * 31 + name.charCodeAt(i)) | 0;
  const jitter = ((Math.abs(salt) * 9301 + 49297) % 233280) / 233280;
  const v = 3800 + Math.round(jitter * 500);
  const rounded = Math.round(v / 10) * 10;
  return rounded.toLocaleString() + ' videos';
}
