import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function verifySignature(body: string, signature: string | null) {
  const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  const sig = request.headers.get("x-cf-signature");

  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse and map Stream status updates to `videos` + `video_assets`.
  return NextResponse.json({ ok: true });
}
