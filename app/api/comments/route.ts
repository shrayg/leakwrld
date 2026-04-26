import { NextResponse } from "next/server";
import { z } from "zod";
import { canPostComment } from "@/lib/trust-safety";

const schema = z.object({
  userId: z.string().uuid().nullable(),
  videoOwnerId: z.string().uuid(),
  body: z.string().min(1).max(5000),
});

export async function POST(request: Request) {
  const payload = schema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const allowed = canPostComment(payload.data.userId, payload.data.videoOwnerId, false);
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  return NextResponse.json({ ok: true });
}
