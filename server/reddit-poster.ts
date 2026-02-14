import Snoowrap from "snoowrap";

let redditClient: Snoowrap | null = null;

function getRedditClient(): Snoowrap | null {
  if (redditClient) return redditClient;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) {
    return null;
  }

  redditClient = new Snoowrap({
    userAgent: "Gemin-Eye/1.0 (by /u/" + username + ")",
    clientId,
    clientSecret,
    username,
    password,
  });

  redditClient.config({ requestDelay: 1000, continueAfterRatelimitError: true });

  return redditClient;
}

export function isRedditConfigured(): boolean {
  return !!(
    process.env.REDDIT_CLIENT_ID &&
    process.env.REDDIT_CLIENT_SECRET &&
    process.env.REDDIT_USERNAME &&
    process.env.REDDIT_PASSWORD
  );
}

export async function postRedditComment(postUrl: string, commentText: string): Promise<{ success: boolean; commentUrl?: string; error?: string }> {
  const client = getRedditClient();
  if (!client) {
    return { success: false, error: "Reddit credentials not configured. Add REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD." };
  }

  try {
    const postId = extractPostId(postUrl);
    if (!postId) {
      return { success: false, error: "Could not extract Reddit post ID from URL: " + postUrl };
    }

    const submission = client.getSubmission(postId);
    const comment: any = await (submission as any).reply(commentText);
    const commentUrl = `https://www.reddit.com${comment.permalink || ""}`;

    return { success: true, commentUrl };
  } catch (error: any) {
    console.error("Reddit post error:", error);
    const msg = error?.message || String(error);
    if (msg.includes("RATELIMIT") || msg.includes("rate limit")) {
      return { success: false, error: "Reddit rate limit hit. Wait a few minutes and try again." };
    }
    if (msg.includes("403") || msg.includes("Forbidden")) {
      return { success: false, error: "Reddit credentials invalid or account lacks permission." };
    }
    return { success: false, error: "Reddit API error: " + msg.slice(0, 200) };
  }
}

export async function postRedditSubmission(subreddit: string, title: string, body: string): Promise<{ success: boolean; postUrl?: string; error?: string }> {
  const client = getRedditClient();
  if (!client) {
    return { success: false, error: "Reddit credentials not configured. Add REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD." };
  }

  try {
    const sub = subreddit.replace(/^r\//, "");
    const submission: any = await (client.getSubreddit(sub) as any).submitSelfpost({ title, text: body });
    const postUrl = `https://www.reddit.com${submission.permalink || ""}`;

    return { success: true, postUrl };
  } catch (error: any) {
    console.error("Reddit submission error:", error);
    const msg = error?.message || String(error);
    if (msg.includes("RATELIMIT") || msg.includes("rate limit")) {
      return { success: false, error: "Reddit rate limit hit. Wait a few minutes and try again." };
    }
    if (msg.includes("SUBREDDIT_NOEXIST")) {
      return { success: false, error: "That subreddit doesn't exist." };
    }
    return { success: false, error: "Reddit API error: " + msg.slice(0, 200) };
  }
}

function extractPostId(url: string): string | null {
  const patterns = [
    /reddit\.com\/r\/\w+\/comments\/([a-z0-9]+)/i,
    /redd\.it\/([a-z0-9]+)/i,
    /reddit\.com\/comments\/([a-z0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}
