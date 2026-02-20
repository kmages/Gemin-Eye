interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text?: { type: string; text: string }; url?: string; action_id?: string }>;
  accessory?: { type: string; text: { type: string; text: string; emoji?: boolean }; url: string };
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<b>(.*?)<\/b>/gi, "*$1*")
    .replace(/<i>(.*?)<\/i>/gi, "_$1_")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "```$1```")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export async function sendSlackMessage(
  webhookUrl: string,
  leadMsg: string,
  responseText?: string,
  postUrl?: string | null,
): Promise<boolean> {
  try {
    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "New Lead Found", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: htmlToPlain(leadMsg).slice(0, 2900) },
      },
    ];

    if (responseText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "*Suggested Response (copy & paste):*\n```" + responseText.slice(0, 2900) + "```" },
      });
    }

    if (postUrl) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open Post" },
            url: postUrl,
            action_id: "open_post",
          },
        ],
      });
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!res.ok) {
      console.error(`Slack webhook error: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`Slack send error: ${err?.message || err}`);
    return false;
  }
}

export function getDefaultSlackWebhook(): string | null {
  return process.env.SLACK_WEBHOOK || null;
}

export function getSlackWebhook(businessWebhookUrl: string | null): string | null {
  return businessWebhookUrl || getDefaultSlackWebhook();
}

export function isSlackWebhookUrl(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\//.test(url);
}
