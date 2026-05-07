export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Strips Reddit RSS feed boilerplate that appears at the end of every post:
//   "submitted by /u/<username> [link] [comments]"
// and Atom-style "submitted by <a href=...>/u/x</a>" variants.
export function cleanRedditRssArtifacts(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*submitted by\s+\/u\/[A-Za-z0-9_\-]+(?:\s*\[link\])?(?:\s*\[comments\])?\s*$/i, "")
    .replace(/\s*\[link\]\s*\[comments\]\s*$/i, "")
    .trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const paramsToStrip = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"];
    for (const p of paramsToStrip) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}
