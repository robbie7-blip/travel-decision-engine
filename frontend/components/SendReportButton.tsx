"use client";

// /admin/trips: send the daily report now, to ADMIN_REPORT_EMAIL (the
// route takes no address). For checking the email looks right without
// waiting for the morning.

import { useState } from "react";

export function SendReportButton() {
  const [state, setState] = useState<"idle" | "sending" | string>("idle");

  async function send() {
    setState("sending");
    try {
      const response = await fetch("/api/admin/daily-report", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      setState(response.ok ? `Sent: ${data.subject ?? ""}` : `Not sent: ${data.detail ?? response.status}`);
    } catch {
      setState("Not sent: network error");
    }
  }

  return (
    <span>
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === "sending"}
        style={{ background: "none", border: "none", padding: 0, color: "var(--grounded)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
      >
        {state === "sending" ? "sending…" : "email it to me now"}
      </button>
      {state !== "idle" && state !== "sending" && <span style={{ marginLeft: 8 }}>{state}</span>}
    </span>
  );
}
