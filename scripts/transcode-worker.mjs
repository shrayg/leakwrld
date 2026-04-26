import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const execFileAsync = promisify(execFile);

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const r2Endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
const r2AccessKey = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const r2SecretKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const r2Bucket = process.env.CLOUDFLARE_R2_BUCKET_RAW;

if (!supabaseUrl || !supabaseServiceRoleKey || !r2Endpoint || !r2AccessKey || !r2SecretKey || !r2Bucket) {
  throw new Error("Missing required environment variables for transcode worker");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const r2 = new S3Client({
  region: "auto",
  endpoint: r2Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: r2AccessKey,
    secretAccessKey: r2SecretKey,
  },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimJob() {
  const { data, error } = await supabase.rpc("claim_transcode_job");
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
}

async function downloadObjectToFile(objectKey, filePath) {
  const response = await r2.send(
    new GetObjectCommand({
      Bucket: r2Bucket,
      Key: objectKey,
    }),
  );
  if (!response.Body) throw new Error("R2 object body missing");
  const bodyStream = response.Body instanceof Readable ? response.Body : Readable.fromWeb(response.Body);
  const chunks = [];
  for await (const chunk of bodyStream) chunks.push(chunk);
  await writeFile(filePath, Buffer.concat(chunks));
}

async function uploadFileToObject(filePath, objectKey) {
  const { createReadStream } = await import("node:fs");
  const stream = createReadStream(filePath);
  await r2.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: objectKey,
      Body: stream,
      ContentType: "video/mp4",
    }),
  );
}

async function markFailed(jobId, message) {
  await supabase
    .from("transcode_jobs")
    .update({ status: "failed", last_error: message.slice(0, 1500), updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function processJob(job) {
  const workDir = await mkdtemp(join(tmpdir(), `pw-transcode-${randomUUID()}-`));
  const sourcePath = join(workDir, "source");
  const output720Path = join(workDir, "720p.mp4");

  try {
    await downloadObjectToFile(job.source_object_key, sourcePath);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      "scale=-2:720",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      output720Path,
    ]);

    await uploadFileToObject(output720Path, job.output_720_object_key);

    await supabase
      .from("video_assets")
      .update({
        mp4_720_object_key: job.output_720_object_key,
      })
      .eq("video_id", job.video_id);

    await supabase
      .from("videos")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("id", job.video_id);

    await supabase
      .from("transcode_jobs")
      .update({ status: "done", updated_at: new Date().toISOString(), last_error: null })
      .eq("id", job.id);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main() {
  while (true) {
    try {
      const job = await claimJob();
      if (!job) {
        await sleep(3000);
        continue;
      }
      try {
        await processJob(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markFailed(job.id, message);
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[transcode-worker]", message);
      await sleep(3000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
