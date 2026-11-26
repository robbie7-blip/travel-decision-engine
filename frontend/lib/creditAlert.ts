// When the Anthropic account runs out of credit.
//
// The API then refuses every call with a 400 "Your credit balance is too
// low". Ask a Local used to read that as a busy server: it tried twice,
// told the traveler "I'm a little overloaded" and counted the question
// against their hour, while the owner heard nothing. Now it is a
// configuration failure (no second try, an honest "temporarily
// unavailable"), and the owner gets one email a day about it, at
// ADMIN_REPORT_EMAIL and nowhere else.
//
// Run: npm run test:credit-alert

import Anthropic from "@anthropic-ai/sdk";
import { sendItineraryEmail } from "./email";
import { getRedis } from "./redis";

/** True when the API refused the call because the account has no credit. */
export function isOutOfCredit(e: unknown): boolean {
  return e instanceof Anthropic.BadRequestError && /credit balance is too low/i.test(e.message ?? "");
}

/** Emails the owner, at most once a day. Never throws. */
export async function alertOutOfCredit(now = new Date()): Promise<void> {
  const to = process.env.ADMIN_REPORT_EMAIL?.trim();
  if (!to) return;
  try {
    const first = await getRedis().set(`alert:anthropic-credit:${now.toISOString().slice(0, 10)}`, "1", { nx: true, ex: 2 * 86_400 });
    if (first !== "OK") return;
    await sendItineraryEmail(
      to,
      "decide is out of Anthropic credit",
      "<p>The Anthropic API is refusing calls: <strong>the credit balance is too low</strong>. " +
        "Ask a Local, trip generation and the blog are not working until it is topped up.</p>" +
        '<p>Add credit at <a href="https://console.anthropic.com/settings/billing">console.anthropic.com, Settings, Billing</a>, ' +
        "and turn on auto-reload there so it does not run out again. Nothing needs redeploying.</p>"
    );
  } catch (e) {
    console.warn("[credit-alert]", e instanceof Error ? e.message : e);
  }
}
