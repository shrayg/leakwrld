import { describe, expect, it } from "vitest";
import { canPostComment, normalizeReason } from "@/lib/trust-safety";

describe("trust safety helpers", () => {
  it("blocks anonymous comments", () => {
    expect(canPostComment(null, crypto.randomUUID(), false)).toBe(false);
  });

  it("normalizes report reason length", () => {
    const long = "a".repeat(800);
    expect(normalizeReason(long).length).toBe(500);
  });
});
