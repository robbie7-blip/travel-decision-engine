"use client";

// "Add starter posts" on /admin/blog: publishes the blog's first posts
// (lib/blogStarter.ts) and reloads the list. Safe to press twice.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StarterPostsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/blog/starter", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { added?: number; skipped?: number; detail?: string };
      if (!res.ok) setNote(data.detail ?? "Could not add the posts.");
      else {
        setNote(`Added ${data.added ?? 0}, already there ${data.skipped ?? 0}.`);
        router.refresh();
      }
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
        onClick={add}
        disabled={busy}
        className="font-ui"
        style={{ minHeight: 44, padding: "0 18px", fontSize: 13, marginLeft: 10, border: "1px solid var(--line)", borderRadius: 999, background: "transparent", color: "var(--ink)", cursor: busy ? "wait" : "pointer" }}
      >
        {busy ? "Adding…" : "Add starter posts"}
      </button>
      {note && <span style={{ fontSize: 12, color: "var(--ink-dim)", marginLeft: 10 }}>{note}</span>}
    </>
  );
}
