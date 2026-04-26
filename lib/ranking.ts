import type { VideoCard } from "@/lib/data";

function hoursSince(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(1, ms / 1000 / 60 / 60);
}

export function rankShorts(items: VideoCard[]) {
  return [...items].sort((a, b) => {
    const scoreA = 0.45 * a.velocity + 0.35 * a.qualityScore + 0.2 * (1 / hoursSince(a.publishedAt));
    const scoreB = 0.45 * b.velocity + 0.35 * b.qualityScore + 0.2 * (1 / hoursSince(b.publishedAt));
    return scoreB - scoreA;
  });
}
