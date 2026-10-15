"use client";

// /admin/trips: take down a published trip page (app/api/admin/published).

import { useState } from "react";

export function AdminUnpublishButton({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  if (state === "done") return <span style={{ color: "var(--ink-dim)" }}>taken down</span>;
  return (
    <button
      type="button"
      disabled={state === "busy"}
      onClick={async () => {
        if (!window.confirm(`Take down /plans/${slug}?`)) return;
        setState("busy");
        const response = await fetch("/api/admin/published", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        }).catch(() => null);
        setState(response?.ok ? "done" : "failed");
      }}
      style={{ background: "none", border: "none", padding: 0, color: "var(--infeasible)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
    >
      {state === "failed" ? "failed, retry" : "take down"}
    </button>
  );
}
