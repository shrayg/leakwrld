/** Locked video registry (tier-gated UX); mirrored from legacy window._PY_LOCKED_VIDEOS */
export const LOCKED_VIDEO_KEYS = {
  'Omegle/bananagrl3.mp4': true,
};

export function isTierLockedVideo(folder, name) {
  const k = `${folder}/${name}`;
  return !!LOCKED_VIDEO_KEYS[k];
}
