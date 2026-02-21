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
  if (!webhookUrl || !isSlackWebhookUrl(webhookUrl)) {
    console.error(`Invalid Slack webhook URL: ${webhookUrl?.slice(0, 30)}...`);
    return false;
  }

  try {
    const plainLead = htmlToPlain(leadMsg).slice(0, 2900);

    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "🔔 New Lead Found", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: plainLead },
      },
    ];

    if (responseText) {
      const sanitizedResponse = responseText.replace(/```/g, "'''").slice(0, 2500);
      blocks.push(
        { type: "divider" } as any,
        {
          type: "section",
          text: { type: "mrkdwn", text: "*💬 Suggested Response (copy & paste):*\n```" + sanitizedResponse + "```" },
        },
      );
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

    const payload = JSON.stringify({ blocks });

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Slack webhook error: ${res.status} - ${errBody} (payload ${payload.length} bytes)`);
      const fallbackPayload = JSON.stringify({
        text: `${plainLead.slice(0, 1500)}\n\n*Suggested Response:*\n${(responseText || "").replace(/```/g, "'''").slice(0, 1000)}${postUrl ? `\n\n<${postUrl}|Open Post>` : ""}`,
      });
      try {
        const fallbackRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: fallbackPayload,
        });
        if (fallbackRes.ok) {
          console.log("Slack fallback plain text sent successfully");
          return true;
        }
        console.error(`Slack fallback also failed: ${fallbackRes.status}`);
      } catch (fallbackErr: any) {
        console.error(`Slack fallback error: ${fallbackErr?.message}`);
      }
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
  return businessWebhookUrl || null;
}

export function isSlackWebhookUrl(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\//.test(url);
}
