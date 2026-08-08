// Transactional email via Resend's REST API — plain fetch, no SDK
// dependency, same "no new infra beyond a key" pattern as
// GOOGLE_PLACES_API_KEY/AMADEUS_API_KEY in the worker. Used only for magic
// links right now. Free tier (100/day, 3000/month as of writing) comfortably
// covers a small subscriber base; swap RESEND_API_KEY/EMAIL_FROM if you
// outgrow it or prefer a different provider — this file is the only place
// that would need to change.

const RESEND_API_URL = "https://api.resend.com/emails";

export class EmailNotConfiguredError extends Error {}

// Carries Resend's own reason (parsed from its JSON error body when
// possible, e.g. "The yourdecide.com domain is not verified" or a rate-
// limit message) so the API route can show it directly instead of a
// generic "couldn't send" message — the alternative is whoever's testing
// sign-in has no way to tell a bad EMAIL_FROM domain apart from a rate
// limit apart from anything else without going and checking Resend's own
// dashboard by hand.
export class EmailSendFailedError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly reason: string
  ) {
    super(`Resend request failed: HTTP ${httpStatus} ${reason}`);
  }
}

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
      // Hex values are hardcoded, not var(--x) — email clients strip CSS
      // custom properties, and this needs to render the same in Gmail/
      // Apple Mail/Outlook regardless of what globals.css defines. #1f6f8a
      // is --brand-teal, kept in sync by hand since there's no shared build
      // step between this file and the app's CSS. A bare "click this link,
      // expires in 15 minutes" email with no branding reads as templated/
      // phishy to both spam filters and a human glancing at it — a visible
      // "decide" name, a real heading, and a styled button in place of a
      // raw URL are what actually change that, more than any one Resend
      // setting does.
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #2b241c;">
          <div style="font-size: 22px; font-weight: 700; color: #1f6f8a; margin-bottom: 24px;">decide</div>
          <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 12px; color: #2b241c;">Sign in to decide</h1>
          <p style="font-size: 14px; line-height: 1.6; color: #4a4136; margin: 0 0 24px;">
            Click the button below to sign in. This link works once and expires in 15 minutes.
          </p>
          <a href="${verifyUrl}" style="display: inline-block; background: #1f6f8a; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 8px; margin-bottom: 8px;">
            Sign in to decide
          </a>
          <p style="font-size: 13px; line-height: 1.5; color: #8a7d68; margin: 24px 0 0;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${verifyUrl}" style="color: #1f6f8a; word-break: break-all;">${verifyUrl}</a>
          </p>
          <p style="font-size: 12px; line-height: 1.5; color: #8a7d68; margin: 24px 0 0; border-top: 1px solid #e3d5b3; padding-top: 16px;">
            If you didn't request this, you can safely ignore this email — no account changes will be made.
          </p>
        </div>
      `,
      text: `decide\n\nSign in to decide\n\nClick the link below to sign in. This link works once and expires in 15 minutes.\n\n${verifyUrl}\n\nIf you didn't request this, you can safely ignore this email — no account changes will be made.`,
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    // Resend's error responses are JSON ({"statusCode":...,"message":"...",
    // "name":"..."}) — pull out .message when present for a clean, specific
    // reason (unverified domain, rate limit, invalid "from" format, etc.);
    // fall back to the raw body for anything that doesn't parse.
    let reason = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed?.message === "string") reason = parsed.message;
    } catch {
      // not JSON — keep the raw text
    }
    throw new EmailSendFailedError(res.status, reason || "no further detail returned");
  }
}
