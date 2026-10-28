"use client";

// "Write a post now" on /admin/blog: runs the blog autopilot once
// (app/api/admin/blog/autopilot), the same thing Mondays and Thursdays do
// on their own. Takes most of a minute: the model writes the whole post.

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
      const data = (await res.json().catch(() => ({}))) as { title?: string; detail?: string };
      setNote(res.ok ? `Published: ${data.title ?? "a new post"}. The Instagram post is in your email.` : data.detail ?? "It did not post.");
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
        {busy ? "Writing… (up to a minute)" : "Write a post now"}
      </button>
      {note && <span style={{ fontSize: 12, color: "var(--ink-dim)", marginLeft: 10 }}>{note}</span>}
    </>
  );
}
