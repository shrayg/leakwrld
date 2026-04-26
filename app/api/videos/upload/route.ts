import { NextResponse } from "next/server";
import { z } from "zod";
import { getSignedUploadUrl } from "@/lib/r2";
import { createServiceClient } from "@/utils/supabase/service";

const uploadSchema = z.object({
  ownerId: z.string().uuid(),
  categorySlug: z.string().min(1),
  title: z.string().min(1).max(180),
  fileName: z.string().min(1),
  fileSizeBytes: z.number().positive().max(1024 * 1024 * 1024),
  mimeType: z.string().startsWith("video/"),
});

function fileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? ".mp4";
}

export async function POST(request: Request) {
  const parsed = uploadSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload metadata" }, { status: 400 });

  const supabase = createServiceClient();
  const videoId = crypto.randomUUID();
  const ext = fileExtension(parsed.data.fileName);
  const basePrefix = `categories/${parsed.data.categorySlug}/${videoId}`;
  const sourceObjectKey = `${basePrefix}/source${ext}`;
  const output720ObjectKey = `${basePrefix}/720p.mp4`;

  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("id, slug")
    .eq("slug", parsed.data.categorySlug)
    .maybeSingle();

  if (categoryError || !category) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }

  const uploadUrl = await getSignedUploadUrl({
    key: sourceObjectKey,
    contentType: parsed.data.mimeType,
  });

  const { error: insertVideoError } = await supabase.from("videos").insert({
    id: videoId,
    owner_id: parsed.data.ownerId,
    title: parsed.data.title,
    category_id: category.id,
    visibility: "private",
    status: "uploaded",
  });

  if (insertVideoError) {
    return NextResponse.json({ error: insertVideoError.message }, { status: 500 });
  }

  const { error: insertAssetError } = await supabase.from("video_assets").insert({
    video_id: videoId,
    ingest_status: "uploaded",
    source_object_key: sourceObjectKey,
    mp4_1080_object_key: sourceObjectKey,
    mp4_720_object_key: output720ObjectKey,
  });

  if (insertAssetError) {
    return NextResponse.json({ error: insertAssetError.message }, { status: 500 });
  }

  const { error: insertJobError } = await supabase.from("transcode_jobs").insert({
    video_id: videoId,
    category_slug: category.slug,
    source_object_key: sourceObjectKey,
    output_720_object_key: output720ObjectKey,
    status: "pending",
  });

  if (insertJobError) {
    return NextResponse.json({ error: insertJobError.message }, { status: 500 });
  }

  return NextResponse.json({
    videoId,
    uploadUrl,
    sourceObjectKey,
    output720ObjectKey,
    status: "pending_upload",
  });
}
