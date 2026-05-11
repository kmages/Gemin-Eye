import { describe, it, expect } from "vitest";
import { keywordMatch, buildGoogleAlertFeeds } from "../../server/utils/keywords";

describe("keywordMatch", () => {
  it("returns false on empty keyword list", () => {
    expect(keywordMatch("anything", [])).toBe(false);
  });

  it("matches a direct case-insensitive substring", () => {
    expect(keywordMatch("I need a Roofing contractor today", ["roofing"])).toBe(true);
  });

  it("matches when all significant words of a multi-word keyword are present (any order)", () => {
    expect(
      keywordMatch(
        "looking for help with water damage in my basement",
        ["basement water"],
      ),
    ).toBe(true);
  });

  it("does NOT match a multi-word keyword when its significant words are absent", () => {
    expect(keywordMatch("nothing relevant here", ["the question"])).toBe(false);
  });

  it("ignores stop words when matching a multi-word keyword (only significant words must be present)", () => {
    expect(
      keywordMatch("I had a weather question about today's storm", ["the weather question"]),
    ).toBe(true);
  });

  it("ignores empty/whitespace keywords gracefully", () => {
    expect(keywordMatch("hello world", ["", "   "])).toBe(false);
  });
});

describe("buildGoogleAlertFeeds", () => {
  it("returns an empty list when there are no inputs", () => {
    expect(buildGoogleAlertFeeds([], "")).toEqual([]);
  });

  it("emits Google News RSS URLs and caps at 5", () => {
    const feeds = buildGoogleAlertFeeds(
      ["roof leak", "water damage", "basement flood", "mold removal", "storm damage", "ice dam", "burst pipe", "sump pump"],
      "Roofing and Restoration",
    );
    expect(feeds.length).toBeGreaterThan(0);
    expect(feeds.length).toBeLessThanOrEqual(5);
    for (const f of feeds) {
      expect(f.startsWith("https://news.google.com/rss/search?q=")).toBe(true);
      expect(f).toContain("hl=en-US");
    }
  });

  it("deduplicates equivalent encoded queries", () => {
    const feeds = buildGoogleAlertFeeds(["roof", "roof"], "roof");
    const unique = new Set(feeds);
    expect(unique.size).toBe(feeds.length);
  });
});
