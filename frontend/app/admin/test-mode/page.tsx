"use client";

// Password-protected (see middleware.ts) internal tool: paste ADMIN_PASSWORD
// once to flip this browser into "test mode" for new generations — every
// /api/generate call from it then skips the daily budget cap, the per-IP/
// per-email rate limits, AND the web_search step entirely (see the
// Job.testMode comment in lib/jobs.ts), for fast, cheap iteration while
// building. There's no server-side validation call here: entering the wrong
// value just means /api/generate silently ignores the header and behaves
// like a normal request (see isTestModeRequest in app/api/generate/route.ts)
// — reaching this page at all already required knowing the real
// ADMIN_PASSWORD, so there's nothing to protect against here that
// middleware.ts hasn't already gated.

import { useEffect, useState } from "react";
import { markAdminUi } from "@/lib/adminUi";
import { getTestModeKey, setTestModeKey } from "@/lib/testMode";

export default function TestModeAdminPage() {
  const [enabled, setEnabled] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    markAdminUi();
    setEnabled(getTestModeKey() !== null);
  }, []);

  function enable() {
    if (!input.trim()) return;
    setTestModeKey(input.trim());
    setEnabled(true);
    setInput("");
  }

  function disable() {
    setTestModeKey(null);
    setEnabled(false);
  }

  return (
    <div style={{ maxWidth: 480, margin: "48px auto", padding: "0 24px" }}>
      <h1 className="font-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Test mode
      </h1>
      <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, marginBottom: 20 }}>
        When on, generations from THIS BROWSER skip the daily budget cap, all rate limits, and the
        web_search step (cheaper + much faster, still a real Claude call). Nothing here affects any
        other visitor.
      </p>

      <div
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 20,
          boxShadow: "var(--shadow-panel)",
        }}
      >
        <div className="font-mono" style={{ fontSize: 12, marginBottom: 14 }}>
          Status:{" "}
          <span style={{ color: enabled ? "var(--accent-green)" : "var(--ink-dim)", fontWeight: 700 }}>
            {enabled ? "ON" : "OFF"}
          </span>
        </div>

        {enabled ? (
          <button
            onClick={disable}
            className="font-mono"
            style={{
              border: "1px solid var(--line)",
              borderRadius: 999,
              padding: "8px 16px",
              fontSize: 12,
              background: "transparent",
              color: "var(--ink-soft)",
              cursor: "pointer",
            }}
          >
            Turn off
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ADMIN_PASSWORD"
              style={{
                flex: 1,
                background: "var(--bg-panel-raised)",
                border: "1px solid var(--line-strong)",
                borderRadius: 8,
                padding: "10px 13px",
                color: "var(--ink)",
                fontSize: 14,
                boxSizing: "border-box",
                boxShadow: "inset 0 1px 3px rgba(43, 36, 28, 0.08)",
              }}
            />
            <button
              onClick={enable}
              disabled={!input.trim()}
              className="font-mono btn-primary"
              style={{
                padding: "10px 16px",
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor: input.trim() ? "pointer" : "default",
                flexShrink: 0,
              }}
            >
              Enable
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
