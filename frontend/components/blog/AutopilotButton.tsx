"use client";

// "Write a post now" on /admin/blog: runs the blog autopilot once
// (app/api/admin/blog/autopilot), the same thing Mondays and Thursdays do
// on their own. Takes up to three minutes: the model may search the web,
// writes the whole post, and a second one proofreads it.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AutopilotButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/blog/autopilot", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { title?: string; detail?: string; status?: string };
      const title = data.title ?? "a new post";
      setNote(
        !res.ok
          ? data.detail ?? "It did not post."
          : data.status === "draft"
            ? `Saved as a draft, not published: ${title}. The copy check wants a look; open it below.`
            : `Published: ${title}. The Instagram post is in your email.`
      );
      if (res.ok) router.refresh();
    } catch {
      setNote("Could not reach the site.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="font-ui"
        style={{ minHeight: 44, padding: "0 18px", fontSize: 13, marginLeft: 10, border: "1px solid var(--line)", borderRadius: 999, background: "transparent", color: "var(--ink)", cursor: busy ? "wait" : "pointer" }}
      >
        {busy ? "Writing… (up to three minutes)" : "Write a post now"}
      </button>
      {note && <span style={{ fontSize: 12, color: "var(--ink-dim)", marginLeft: 10 }}>{note}</span>}
    </>
  );
}
