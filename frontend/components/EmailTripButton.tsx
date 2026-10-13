"use client";

// "Email it to me", beside the calendar export and Print.
//
// The three answer the same question asked three ways: how do I keep this
// once I am off this page. The calendar export and the print dialogue were
// already here; Resend has been wired up for sign-in links since accounts
// existed, and the address on the account is a verified one - so the only
// missing piece was the asking.
//
// IT ONLY EVER SENDS TO THE SIGNED-IN ADDRESS, and the button carries no
// email field for that reason. A trip link is a public capability: a route
// that accepted an address would be a way to send mail from this domain to
// anywhere. See app/api/trip-email, which takes the address from the
// session and nothing from the body but the trip id.
//
// Which is why 401 is a first-class state here rather than an error. A
// signed-out visitor is not doing anything wrong, they just have no
// address on file, so they get a sentence and a way to fix it.

import { useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

type State = "idle" | "sending" | "sent" | "signin" | "failed";

export function EmailTripButton({
  jobId,
  t,
  language,
}: {
  jobId: string;
  t: Dictionary;
  language?: Language;
}) {
  const [state, setState] = useState<State>("idle");
  const copy = t.result.emailTrip;
  const suffix = language === "bg" ? "?lang=bg" : "";

  async function send() {
    if (state === "sending" || state === "sent") return;
    setState("sending");
    try {
      const res = await fetch("/api/trip-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (res.status === 401) {
        setState("signin");
        return;
      }
      setState(res.ok ? "sent" : "failed");
    } catch {
      // No network. Same wording as a refusal - from here they are the
      // same thing, and the trip page is readable offline anyway.
      setState("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={send}
        disabled={state === "sending" || state === "sent"}
        className="font-ui no-print trip-action"
      >
        {/* An envelope, drawn rather than an emoji, to match the arrow and
            printer glyphs the two buttons beside this one use. */}
        <svg viewBox="0 0 24 24" aria-hidden style={{ width: 14, height: 14 }}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3.6 6.6l8.4 6 8.4-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {state === "sending" ? copy.sending : state === "sent" ? copy.sent : copy.button}
      </button>
      {state === "signin" && (
        <span className="font-ui no-print trip-action-note">
          <Link href={`/account${suffix}`}>{copy.signInFirst} &rarr;</Link>
        </span>
      )}
      {state === "failed" && <span className="font-ui no-print trip-action-note">{copy.failed}</span>}
    </>
  );
}
