/** Fire-and-forget Discord message. Never throws; no pings. */
export async function postDiscord(webhook: string | undefined, content: string): Promise<void> {
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
  } catch {
    // Monitoring must never break the request.
  }
}
