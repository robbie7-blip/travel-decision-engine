import type { Metadata } from "next";
import Link from "next/link";

// Where the tester link lands (app/tester/[code]): says it worked, in both
// languages, and sends them to plan a trip.

export const metadata: Metadata = { title: "Welcome, tester", robots: { index: false, follow: false } };

export default function TesterWelcomePage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "var(--bg)" }}>
      <div style={{ maxWidth: 480, textAlign: "center", color: "var(--ink)" }}>
        <h1 className="font-display" style={{ fontSize: 30, margin: "0 0 12px" }}>
          You&apos;re in!
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink-soft)", margin: "0 0 8px" }}>
          This browser now has the full plan for testing: plan trips, push back on them, and ask Ask a Local anything. No account needed. Please tell
          us what works and what doesn&apos;t.
        </p>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink-soft)", margin: "0 0 24px" }} lang="bg">
          Вече имаш пълния план за тестване: планирай пътувания, променяй ги и питай Питай местен каквото искаш. Без акаунт. Кажи ни какво работи и какво
          не.
        </p>
        <Link href="/" className="font-ui btn-primary" style={{ display: "inline-block", padding: "12px 24px", minHeight: 44, boxSizing: "border-box", textDecoration: "none" }}>
          Plan a trip · Планирай пътуване
        </Link>
      </div>
    </main>
  );
}
