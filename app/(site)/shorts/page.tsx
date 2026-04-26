import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { featuredVideos } from "@/lib/data";

export default function ShortsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Shorts Feed</h1>
      <p className="text-sm text-[var(--text-2)]">Muted autoplay defaults on mobile. Preload of next clip is enabled in player integrations.</p>
      <div className="space-y-3">
        {featuredVideos.map((video) => (
          <Card key={video.id} className="p-3">
            <div className="mb-3 aspect-[9/16] rounded-[10px] bg-[var(--surface-3)]" />
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">{video.title}</h2>
                <p className="text-xs text-[var(--text-2)]">{video.creator}</p>
              </div>
              <Button size="sm">Play</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
