"use client";

// Friends and family (password-protected by middleware.ts). The easy way
// is the tester link: send it, they tap it, and that browser has the paid
// plan with no account (lib/testerPass.ts). A new link or "Turn off" ends
// every pass from the old one. Below it, emails that get the paid plan
// when signed in, for anyone who wants their trips on every device.

import { useEffect, useState } from "react";
import Link from "next/link";
import { markAdminUi } from "@/lib/adminUi";

export default function TestersAdminPage() {
  const [testers, setTesters] = useState<string[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    markAdminUi();
    fetch("/api/admin/testers")
      .then((r) => r.json())
      .then((d) => {
        setTesters(Array.isArray(d.testers) ? d.testers : []);
        setLink(typeof d.link === "string" ? d.link : null);
      })
      .catch(() => setError("Could not load the list."));
  }, []);

  async function save(address: string, on: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, on }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? "Could not save.");
      setTesters(data.testers);
      if (on) setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function changeLink(action: "new" | "off") {
    if (action === "new" && link && !window.confirm("Make a new link? The old one, and everyone who used it, stops working.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? "Could not save.");
      setLink(data.link ?? null);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  // Safari can refuse the clipboard API without saying so, and then a
  // paste gives whatever was copied before. The old select-and-copy way
  // as a fallback, and a plain message when neither worked.
  async function copyLink(text: string) {
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      return;
    } catch {
      // Fall through to the older way.
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (ok) setCopied(true);
    else setError("Could not copy. Select the link above and copy it by hand.");
  }

  const button = { minHeight: 44, padding: "0 16px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "transparent", color: "var(--ink)", cursor: "pointer" } as const;

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", color: "var(--ink)" }}>
      <Link href="/admin" style={{ color: "var(--grounded)", fontSize: 12, textDecoration: "none" }}>
        ← Admin
      </Link>
      <h1 style={{ fontSize: 20, margin: "16px 0 6px" }}>Testers</h1>
      <h2 style={{ fontSize: 15, margin: "20px 0 6px" }}>Tester link</h2>
      <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 12px" }}>
        Send this to friends and family. They tap it once and that phone or computer gets the full plan, with no email and no sign-in. Rate limits
        and the daily spend cap still apply. If it gets passed around too far, make a new link: the old one stops working for everyone.
      </p>
      {link ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <code style={{ flex: "1 1 260px", fontSize: 13, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, overflowWrap: "anywhere", userSelect: "all" }}>{link}</code>
          <button
            type="button"
            style={button}
            onClick={() => void copyLink(link)}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" style={button} disabled={busy} onClick={() => void changeLink("new")}>
            New link
          </button>
          <button type="button" style={button} disabled={busy} onClick={() => void changeLink("off")}>
            Turn off
          </button>
        </div>
      ) : (
        <button type="button" style={button} disabled={busy} onClick={() => void changeLink("new")}>
          Make a tester link
        </button>
      )}
      <h2 style={{ fontSize: 15, margin: "32px 0 6px" }}>Signed-in testers</h2>
      <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 20px" }}>
        Optional, for anyone who wants their trips on every device: add the email they sign in with on /account, and they get the full plan wherever
        they sign in.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void save(email.trim(), true);
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <input
          type="email"
          aria-label="Tester's email"
          placeholder="friend@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: "1 1 240px", minHeight: 44, padding: "0 12px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--bg-panel-raised)", color: "var(--ink)" }}
        />
        <button type="submit" disabled={busy || !email.trim()} style={button}>
          Add tester
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: "var(--infeasible)", fontSize: 13 }}>
          {error}
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: "24px 0 0" }}>
        {testers === null && <li style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</li>}
        {testers?.length === 0 && <li style={{ fontSize: 13, color: "var(--ink-dim)" }}>No testers yet.</li>}
        {testers?.map((t) => (
          <li key={t} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
            <span style={{ fontSize: 14, overflowWrap: "anywhere" }}>{t}</span>
            <button type="button" disabled={busy} onClick={() => void save(t, false)} style={button}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
