export async function sendWebhookNotification(
  url: string,
  headers: Record<string, string> | undefined,
  payload: unknown,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook notify to ${url} failed: ${res.status} ${res.statusText}`);
  }
}
