"use client";

// The account page's invite box (lib/referral.ts): the link, a share or
// copy button, and what invites have earned so far.

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";

interface ReferralState {
  link: string;
  joined: number;
  bonus: number;
  monthlyCap: number;
}

export function InviteFriend({ t }: { t: Dictionary }) {
  const [state, setState] = useState<ReferralState | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/referral")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.link === "string") setState(data);
      })
      .catch(() => {});
  }, []);

  if (!state) return null;
  const a = t.account;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(state!.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (an old browser, or no permission): the link is
      // on screen and can be selected by hand.
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "decide", text: a.inviteHeading, url: state!.link });
    } catch {
      // Dismissed, or not allowed here.
    }
  }

  return (
    <section aria-labelledby="invite-heading" style={{ borderTop: "1px solid var(--line)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 id="invite-heading" className="font-ui" style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--ink)" }}>
        {a.inviteHeading}
      </h2>
      <p className="font-ui" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-soft)", margin: 0 }}>
        {a.inviteBody.replace("{cap}", String(state.monthlyCap))}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          readOnly
          value={state.link}
          aria-label={a.inviteHeading}
          onFocus={(e) => e.currentTarget.select()}
          className="font-ui"
          style={{ flex: "1 1 200px", minWidth: 0, minHeight: 40, padding: "8px 10px", fontSize: 16, border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg-panel)", color: "var(--ink)" }}
        />
        <button type="button" onClick={canShare ? share : copy} className="font-ui btn-primary invite-button" aria-live="polite">
          {canShare ? a.inviteShare : copied ? a.inviteCopied : a.inviteCopy}
        </button>
      </div>
      {(state.joined > 0 || state.bonus > 0) && (
        <div className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>{a.inviteJoined.replace("{count}", String(state.joined))}</span>
          <span>{a.bonusTrips.replace("{count}", String(state.bonus))}</span>
        </div>
      )}
    </section>
  );
}
