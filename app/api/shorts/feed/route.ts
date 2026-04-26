import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { featuredVideos } from "@/lib/data";
import { rankShorts } from "@/lib/ranking";

const getFeed = unstable_cache(
  async () => rankShorts(featuredVideos),
  ["shorts-feed-v1"],
  { revalidate: 30 },
);

export async function GET() {
  const data = await getFeed();
  return NextResponse.json({ items: data });
}
