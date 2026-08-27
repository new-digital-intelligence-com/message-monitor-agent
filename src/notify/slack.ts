import type { NotifyTarget } from "../types.js";

type SlackTarget = Extract<NotifyTarget, { type: "slack" }>;

export async function sendSlackNotification(
  target: SlackTarget,
  title: string,
  text: string,
  botToken: string | undefined,
): Promise<void> {
  const message = `*${title}*\n${text}`;

  if (target.webhookUrl) {
    const res = await fetch(target.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) {
      throw new Error(`Slack incoming webhook failed: ${res.status} ${res.statusText}`);
    }
    return;
  }

  const channel = target.channel ?? target.userId;
  if (!channel) {
    throw new Error("Slack notify target has neither channel/userId nor webhookUrl");
  }
  if (!botToken) {
    throw new Error(`Slack bot token not configured; cannot post to ${channel}`);
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, text: message }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(`Slack API error posting to ${channel}: ${data.error ?? res.status}`);
  }
}
