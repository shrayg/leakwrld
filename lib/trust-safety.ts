export function canPostComment(userId: string | null, videoOwnerId: string, blocked = false) {
  if (!userId || blocked) return false;
  if (userId === videoOwnerId) return true;
  return true;
}

export function normalizeReason(reason: string) {
  return reason.trim().slice(0, 500);
}
