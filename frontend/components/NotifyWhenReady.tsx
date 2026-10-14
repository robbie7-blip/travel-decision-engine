"use client";

// "Email it to me when it's ready", on the wait screen.
//
// The wait is about a minute and it is the moment people switch tabs. A
// plan that was paid for and then never seen is the worst outcome the
// product has, so this makes leaving safe: the worker tells the site when
// the trip is saved, and the site emails it to the signed-in address. See
// app/api/trip-email/notify.
//
// Same rule as EmailTripButton: no address field, ever. The address is the
// session's, which is what stops this being a way to send mail anywhere.

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

type State = "idle" | "sending" | "scheduled" | "sent" | "signin" | "failed";

export function NotifyWhenReady({ jobId, t, language }: { jobId: string; t: Dictionary; language: Language }) {
  const [state, setState] = useState<State>("idle");
  const copy = t.trip.notify;

  async function ask() {
    if (state === "sending" || state === "scheduled" || state === "sent") return;
    setState("sending");
    try {
      const res = await fetch("/api/trip-email/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (res.status === 401) {
        setState("signin");
        return;
      }
      const data = (await res.json().catch(() => null)) as { status?: string } | null;
      setState(!res.ok ? "failed" : data?.status === "sent" ? "sent" : "scheduled");
    } catch {
      setState("failed");
    }
  }

  if (state === "scheduled" || state === "sent") {
    return (
      <p className="trip-notify trip-notify-done font-ui" role="status">
        <span className="trip-notify-check" aria-hidden>
          ✓
        </span>
        {state === "sent" ? copy.sent : copy.scheduled}
      </p>
    );
  }

  return (
    <div className="trip-notify font-ui">
      <button type="button" className="trip-notify-button" onClick={ask} disabled={state === "sending"}>
        <svg viewBox="0 0 24 24" aria-hidden className="trip-notify-icon">
          <rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3.6 6.6l8.4 6 8.4-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {state === "sending" ? copy.sending : copy.button}
      </button>
      {state === "signin" && (
        // A new tab, so signing in does not take them off the wait.
        <a
          className="trip-notify-note inline-link"
          href={language === "bg" ? "/account?lang=bg" : "/account"}
          target="_blank"
          rel="noopener noreferrer"
        >
          {copy.signIn} →
        </a>
      )}
      {state === "failed" && (
        <span className="trip-notify-note" role="status">
          {copy.failed}
        </span>
      )}
    </div>
  );
}
