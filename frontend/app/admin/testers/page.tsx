"use client";

// Friends and family (password-protected by middleware.ts): add the email
// someone signs in with and they get the yearly plan's allowance for free,
// straight away. Take them off and they are back on the free plan.

import { useEffect, useState } from "react";
import Link from "next/link";
import { markAdminUi } from "@/lib/adminUi";

export default function TestersAdminPage() {
  const [testers, setTesters] = useState<string[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    markAdminUi();
    fetch("/api/admin/testers")
      .then((r) => r.json())
      .then((d) => setTesters(Array.isArray(d.testers) ? d.testers : []))
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

  const button = { minHeight: 44, padding: "0 16px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "transparent", color: "var(--ink)", cursor: "pointer" } as const;

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", color: "var(--ink)" }}>
      <Link href="/admin" style={{ color: "var(--grounded)", fontSize: 12, textDecoration: "none" }}>
        ← Admin
      </Link>
      <h1 style={{ fontSize: 20, margin: "16px 0 6px" }}>Testers</h1>
      <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 20px" }}>
        Friends and family testing decide. Add the email they sign in with: they get the yearly plan&apos;s allowance for free, from their next trip. They
        need to sign in on /account with that same email; without signing in they only get the one trip everyone gets.
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
