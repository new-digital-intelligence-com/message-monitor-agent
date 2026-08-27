import type { AccountConfig, FilterRule, NormalizedMessage } from "../types.js";

export function formatSummary(
  message: NormalizedMessage,
  account: AccountConfig,
  matchedRules: FilterRule[],
): { title: string; text: string } {
  const from = message.from.name
    ? `${message.from.name} <${message.from.address}>`
    : message.from.address;
  const channelLabel = message.channel === "email" ? "Email" : "LinkedIn";
  const title = message.subject
    ? `${channelLabel}: ${message.subject}`
    : `${channelLabel} message from ${from}`;

  const ruleNote = matchedRules.length
    ? `Matched rule(s): ${matchedRules.map((r) => r.description ?? r.id).join(", ")}`
    : "No specific rule matched — sent via account default.";

  const body = message.bodyText?.trim() || message.snippet?.trim() || "(no preview available)";
  const truncated = body.length > 1000 ? `${body.slice(0, 1000)}…` : body;

  const text = [
    `Account: ${account.label} (${account.id})`,
    `From: ${from}`,
    message.to?.length ? `To: ${message.to.join(", ")}` : undefined,
    ruleNote,
    "",
    truncated,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  return { title, text };
}
