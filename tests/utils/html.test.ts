import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  stripHtml,
  cleanRedditRssArtifacts,
  truncate,
  canonicalizeUrl,
} from "../../server/utils/html";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("a&b's")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;a&amp;b&#39;s&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands first so existing entities aren't double-decoded later", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("stripHtml", () => {
  it("strips tags and decodes common entities", () => {
    expect(stripHtml("<p>hi &amp; bye</p>")).toBe("hi & bye");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("<div>a</div>\n\n<div>b</div>")).toBe("a b");
  });
});

describe("cleanRedditRssArtifacts", () => {
  it("removes 'submitted by /u/...' trailer", () => {
    expect(
      cleanRedditRssArtifacts("Real post body here submitted by /u/foo_bar [link] [comments]"),
    ).toBe("Real post body here");
  });

  it("removes bare [link] [comments]", () => {
    expect(cleanRedditRssArtifacts("Body [link] [comments]")).toBe("Body");
  });

  it("leaves clean text alone", () => {
    expect(cleanRedditRssArtifacts("Nothing to strip here")).toBe("Nothing to strip here");
  });
});

describe("truncate", () => {
  it("returns the original when shorter than max", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });

  it("truncates and appends ellipsis when longer", () => {
    expect(truncate("abcdef", 3)).toBe("abc...");
  });
});

describe("canonicalizeUrl", () => {
  it("strips utm_* and tracking params", () => {
    expect(
      canonicalizeUrl("https://x.com/y?utm_source=a&utm_medium=b&keep=1&fbclid=z"),
    ).toBe("https://x.com/y?keep=1");
  });

  it("strips fragment", () => {
    expect(canonicalizeUrl("https://x.com/y#frag")).toBe("https://x.com/y");
  });

  it("returns input unchanged when not a valid URL", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});
