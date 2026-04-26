import { NextResponse } from "next/server";
import { getSignedReadUrl } from "@/lib/r2";
import { createServiceClient } from "@/utils/supabase/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const supabase = createServiceClient();

  const { data: asset, error } = await supabase
    .from("video_assets")
    .select("video_id, mp4_1080_object_key, mp4_720_object_key")
    .eq("video_id", params.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!asset) {
    return NextResponse.json({ error: "Video assets not found" }, { status: 404 });
  }

  const [url1080, url720] = await Promise.all([
    asset.mp4_1080_object_key
      ? getSignedReadUrl({ key: asset.mp4_1080_object_key })
      : Promise.resolve(null),
    asset.mp4_720_object_key
      ? getSignedReadUrl({ key: asset.mp4_720_object_key })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    videoId: params.id,
    sources: [
      url1080 ? { quality: "1080p", url: url1080 } : null,
      url720 ? { quality: "720p", url: url720 } : null,
    ].filter(Boolean),
  });
}
