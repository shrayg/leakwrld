import { notFound } from "next/navigation";
import { featuredVideos } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ReportButton } from "@/components/features/report-button";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const video = featuredVideos.find((entry) => entry.id === resolvedParams.id);

  if (!video) notFound();

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[12px] border border-[var(--border-1)] bg-[var(--surface-2)]">
        <div className="aspect-video bg-[var(--surface-3)]" />
      </section>
      <section>
        <h1 className="text-lg font-bold">{video.title}</h1>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-2)]">{video.creator}</p>
          <ReportButton entityId={video.id} />
        </div>
      </section>
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Comments</h2>
        <Textarea placeholder="Add a comment..." />
        <Button className="mt-2" size="sm">
          Post comment
        </Button>
      </Card>
    </div>
  );
}
