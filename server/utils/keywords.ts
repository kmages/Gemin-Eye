const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "and", "but", "or", "nor", "not", "so", "yet", "both",
  "each", "few", "more", "most", "other", "some", "such", "no",
  "only", "own", "same", "than", "too", "very", "just", "about",
  "up", "it", "its", "i", "me", "my", "we", "our", "you", "your",
  "he", "him", "his", "she", "her", "they", "them", "their", "this",
  "that", "these", "those", "what", "which", "who", "whom", "how",
  "all", "any", "if", "because", "when", "where", "while",
]);

function getSignificantWords(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

export function keywordMatch(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = text.toLowerCase();

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase().trim();
    if (!kwLower) continue;

    if (lower.includes(kwLower)) return true;

    const significantWords = getSignificantWords(kwLower);
    if (significantWords.length >= 2) {
      const allPresent = significantWords.every(w => lower.includes(w));
      if (allPresent) return true;
    }
  }

  return false;
}

export function buildGoogleAlertFeeds(keywords: string[], businessType: string): string[] {
  const topKeywords = keywords.slice(0, 8);

  const searchQueries: string[] = [];

  if (topKeywords.length >= 4) {
    searchQueries.push(topKeywords.slice(0, 2).join("+"));
    searchQueries.push(topKeywords.slice(2, 4).join("+"));
    if (topKeywords.length >= 6) {
      searchQueries.push(topKeywords.slice(4, 6).join("+"));
    }
  } else if (topKeywords.length >= 2) {
    searchQueries.push(topKeywords.slice(0, 2).join("+"));
  }

  const typeWords = businessType.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).slice(0, 3).join("+");
  if (typeWords) {
    searchQueries.push(typeWords);
  }

  const seen = new Set<string>();
  const feeds: string[] = [];
  for (const q of searchQueries) {
    const encoded = encodeURIComponent(q).replace(/%2B/g, "+");
    if (seen.has(encoded)) continue;
    seen.add(encoded);
    feeds.push(`https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`);
  }

  return feeds.slice(0, 5);
}
