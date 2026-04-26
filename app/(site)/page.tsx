import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { featuredVideos } from "@/lib/data";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-[14px] border border-[var(--border-1)] bg-[var(--surface-2)] p-4 sm:p-6">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[var(--text-2)]">Global-ready beta</p>
        <h1 className="text-2xl font-bold sm:text-3xl">Sharp, fast short-video discovery built mobile-first.</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-2)]">
          Trust/safety-by-default foundation with category depth, creator profiles, comments, moderation hooks, and Cloudflare Stream playback.
        </p>
        <div className="mt-4 flex gap-2">
          <Link href="/shorts">
            <Button>Watch Shorts</Button>
          </Link>
          <Link href="/upload">
            <Button variant="secondary">Upload video</Button>
          </Link>
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {featuredVideos.map((video) => (
          <Card key={video.id}>
            <div className="mb-3 aspect-[9/16] rounded-[10px] bg-[var(--surface-3)]" />
            <div className="mb-2 flex items-center justify-between">
              <Chip>{video.category}</Chip>
              <span className="text-xs text-[var(--text-2)]">{video.duration}</span>
            </div>
            <h2 className="text-sm font-semibold">{video.title}</h2>
            <p className="text-xs text-[var(--text-2)]">{video.creator}</p>
            <p className="mt-1 text-xs text-[var(--text-2)]">{video.views} views</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
