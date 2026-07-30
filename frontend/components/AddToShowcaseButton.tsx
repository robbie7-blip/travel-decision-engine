"use client";

// Lets an already-authenticated admin add the current /trip/[jobId] straight
// to the /showcase gallery, without copying the jobId over to
// /admin/showcase by hand. Visibility is driven purely by a localStorage
// flag (see lib/adminUi.ts) set by the /admin/* pages themselves, NOT by
// probing /api/admin/showcase on load — an earlier version did that and it
// meant every visitor who opened a shared /trip/[jobId] link got a native
// browser Basic Auth popup, because some browsers (Safari included) show
// that dialog for a background fetch() against a 401-challenging URL, not
// just for a top-level page navigation. Only the click-to-add action itself
// talks to the protected endpoint now, which is a deliberate admin action
// rather than something that fires on every page load for every visitor.

import { useEffect, useState } from "react";
import { isAdminUi } from "@/lib/adminUi";

type AddStatus = "idle" | "loading" | "added" | "error";

export function AddToShowcaseButton({ jobId }: { jobId: string }) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<AddStatus>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setVisible(isAdminUi());
  }, []);

  if (!visible) return null;

  async function handleAdd() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/admin/showcase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        // "already in the showcase" isn't really an error from the
        // clicker's point of view — treat it the same as a fresh add.
        if (res.status === 400 && typeof data.detail === "string" && data.detail.includes("already")) {
          setStatus("added");
          return;
        }
        setError(data.detail ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setStatus("added");
    } catch {
      setError("Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={handleAdd}
        disabled={status === "loading" || status === "added"}
        className="font-mono"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 6,
          padding: "6px 12px",
          fontSize: 12,
          background: "transparent",
          color: status === "added" ? "var(--ink-dim)" : "var(--grounded)",
          cursor: status === "added" ? "default" : "pointer",
        }}
      >
        {status === "added" ? "✓ In showcase gallery" : status === "loading" ? "Adding…" : "+ Add to showcase"}
      </button>
      {status === "error" && <span style={{ fontSize: 12, color: "var(--infeasible)" }}>{error}</span>}
    </div>
  );
}
