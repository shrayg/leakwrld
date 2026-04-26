import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeReason } from "@/lib/trust-safety";

const reportSchema = z.object({
  entityType: z.enum(["video", "comment", "profile"]),
  entityId: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = reportSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid report payload" }, { status: 400 });

  // Wire to moderation queue insertion in production.
  const sanitizedReason = normalizeReason(parsed.data.reason);
  return NextResponse.json({ ok: true, reason: sanitizedReason });
}
