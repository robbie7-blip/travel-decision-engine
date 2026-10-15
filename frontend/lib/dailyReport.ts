// The owner's morning email: yesterday's trips at a glance - how many,
// how many failed the quality check and why, how long they took, what
// they cost. Real traffic only; test runs are counted on one line.
//
// Pure: the rows go in, the email comes out. Sending and scheduling are
// in lib/dailyReportRun.ts and the two routes that call it.
//
// Everything a traveller typed (city names, error text) is escaped: this
// is HTML built from user input, landing in an inbox.
//
// Run: npm run test:daily-report

import type { AdminTrip } from "./tripsQuery";

export interface DailyReport {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A defect line without its numbers, so "day 2 has no lunch" and "day 3
 * has no lunch" count as the same problem. */
function defectKind(detail: string): string {
  return detail.replace(/\d+(\.\d+)?/g, "N").replace(/\s+/g, " ").trim();
}

export function buildDailyReport(trips: AdminTrip[], siteUrl: string, now = new Date()): DailyReport {
  const real = trips.filter((t) => !t.testMode);
  const tests = trips.length - real.length;
  const generated = real.filter((t) => t.kind !== "edit");
  const failed = generated.filter((t) => t.status === "error");
  const checked = generated.filter((t) => t.status === "done" && t.passed !== null);
  const passed = checked.filter((t) => t.passed).length;
  const times = generated.map((t) => t.totalMs).filter((n): n is number => typeof n === "number");
  const costs = generated.map((t) => t.costUsd).filter((n): n is number => typeof n === "number");
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const med = median(times);

  const kinds = new Map<string, number>();
  for (const trip of generated) for (const d of trip.defectDetails) kinds.set(defectKind(d), (kinds.get(defectKind(d)) ?? 0) + 1);
  const topDefects = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const problems = generated.filter((t) => t.status === "error" || t.passed === false).slice(0, 10);
  const date = now.toISOString().slice(0, 10);
  const passRate = checked.length > 0 ? `${Math.round((passed / checked.length) * 100)}%` : "-";

  const subject =
    generated.length === 0
      ? `decide ${date}: no trips yesterday`
      : `decide ${date}: ${generated.length} trip${generated.length === 1 ? "" : "s"}, ${passRate} passed` +
        (failed.length ? `, ${failed.length} failed` : "");

  const stats: [string, string][] = [
    ["Trips", `${generated.length} (${generated.filter((t) => t.kind === "refine").length} pushbacks)`],
    ["Hand edits", String(real.length - generated.length)],
    ["Passed quality", `${passRate} (${passed} of ${checked.length})`],
    ["Failed outright", String(failed.length)],
    ["Median time", med === null ? "-" : `${Math.round(med / 1000)}s`],
    ["Cost", `$${totalCost.toFixed(2)} total, ${costs.length ? `$${(totalCost / costs.length).toFixed(2)}` : "-"} average`],
    ["Signed in", String(generated.filter((t) => t.signedIn).length)],
  ];
  if (tests > 0) stats.push(["Test runs (not counted)", String(tests)]);

  const tripUrl = (id: string) => `${siteUrl.replace(/\/$/, "")}/trip/${encodeURIComponent(id)}`;
  const problemLine = (t: AdminTrip) =>
    `${t.destinations.join(" · ") || "(no city)"} - ${
      t.status === "error" ? `failed${t.error ? `: ${t.error.slice(0, 120)}` : ""}` : `${t.defects ?? 0} defect(s)`
    }`;

  const text = [
    subject,
    "",
    ...stats.map(([k, v]) => `${k}: ${v}`),
    ...(topDefects.length ? ["", "Most common problems:", ...topDefects.map(([k, n]) => `  ${n}x ${k}`)] : []),
    ...(problems.length ? ["", "Trips to look at:", ...problems.map((t) => `  ${problemLine(t)}\n  ${tripUrl(t.id)}`)] : []),
    "",
    `All trips: ${siteUrl.replace(/\/$/, "")}/admin/trips`,
  ].join("\n");

  const cell = "padding:6px 12px 6px 0;font-size:14px;";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f1;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1a17">
<div style="max-width:560px;margin:0 auto">
<h1 style="font-size:20px;color:#2c6a4c;margin:0 0 16px">${escapeHtml(subject)}</h1>
<table style="border-collapse:collapse;margin-bottom:20px">${stats
    .map(([k, v]) => `<tr><td style="${cell}color:#605c54">${escapeHtml(k)}</td><td style="${cell}font-weight:600">${escapeHtml(v)}</td></tr>`)
    .join("")}</table>
${
  topDefects.length
    ? `<h2 style="font-size:15px;margin:0 0 8px">Most common problems</h2><ul style="margin:0 0 20px;padding-left:18px;font-size:14px">${topDefects
        .map(([k, n]) => `<li>${n}× ${escapeHtml(k)}</li>`)
        .join("")}</ul>`
    : ""
}
${
  problems.length
    ? `<h2 style="font-size:15px;margin:0 0 8px">Trips to look at</h2><ul style="margin:0 0 20px;padding-left:18px;font-size:14px">${problems
        .map((t) => `<li style="margin-bottom:6px"><a href="${escapeHtml(tripUrl(t.id))}" style="color:#2c6a4c">${escapeHtml(problemLine(t))}</a></li>`)
        .join("")}</ul>`
    : ""
}
<p style="font-size:13px"><a href="${escapeHtml(siteUrl.replace(/\/$/, ""))}/admin/trips" style="color:#2c6a4c">All trips →</a></p>
</div></body></html>`;

  return { subject, html, text };
}
