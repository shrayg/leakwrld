import { describe, expect, it } from "vitest";
import { rankShorts } from "@/lib/ranking";

describe("rankShorts", () => {
  it("sorts by weighted score descending", () => {
    const items = [
      {
        id: "a",
        title: "A",
        creator: "A",
        category: "A",
        views: "1",
        duration: "1:00",
        qualityScore: 0.2,
        velocity: 0.1,
        publishedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "b",
        title: "B",
        creator: "B",
        category: "B",
        views: "2",
        duration: "1:00",
        qualityScore: 0.9,
        velocity: 0.9,
        publishedAt: new Date().toISOString(),
      },
    ];

    const result = rankShorts(items);
    expect(result[0]?.id).toBe("b");
  });
});
