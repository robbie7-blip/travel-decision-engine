// Transactional email via Resend's REST API — plain fetch, no SDK
// dependency, same "no new infra beyond a key" pattern as
// GOOGLE_PLACES_API_KEY/AMADEUS_API_KEY in the worker. Used only for magic
// links right now. Free tier (100/day, 3000/month as of writing) comfortably
// covers a small subscriber base; swap RESEND_API_KEY/EMAIL_FROM if you
// outgrow it or prefer a different provider — this file is the only place
// that would need to change.

const RESEND_API_URL = "https://api.resend.com/emails";

export class EmailNotConfiguredError extends Error {}

export async function sendMagicLinkEmail(to: string, verifyUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new EmailNotConfiguredError("RESEND_API_KEY / EMAIL_FROM are not set — cannot send magic links.");
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Your decide sign-in link",
      html: `
        <p>Click below to sign in to decide. This link works once and expires in 15 minutes.</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
      text: `Click to sign in to decide (expires in 15 minutes, works once):\n${verifyUrl}\n\nIf you didn't request this, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend request failed: HTTP ${res.status} ${body}`);
  }
}
