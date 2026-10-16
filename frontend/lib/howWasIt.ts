// "How was your trip?" - one email the day after a trip ends, to the
// signed-in account that planned it, with three buttons. A tap records the
// answer (app/api/trip-feedback) and opens a page for an optional note.
// The answers are the product's only word from people who actually went.
//
// The buttons are signed per trip, so a link cannot be edited to answer
// for someone else's trip. Sent from the same evening cron as the
// day-ahead email (app/api/cron/day-ahead) - one scheduled job, not two.
//
// Run: npm run test:how-was-it

import { createHmac, timingSafeEqual } from "node:crypto";
import { escapeHtml } from "./itineraryEmail";
import { TRANSLATIONS } from "./i18n";
import type { TripRating } from "./tripsQuery";
import type { Language } from "./types";

export const RATINGS: TripRating[] = ["great", "ok", "bad"];

export function isRating(value: unknown): value is TripRating {
  return value === "great" || value === "ok" || value === "bad";
}

export function howWasItSentKey(jobId: string): string {
  return `howwas:sent:${jobId}`;
}

/** Yesterday where the travellers are (Sofia's calendar, as for the
 * day-ahead email): the trips that ended then are the ones to ask about. */
export function yesterdayIso(now = new Date(), timeZone = "Europe/Sofia"): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

export function feedbackToken(jobId: string): string {
  return createHmac("sha256", secret()).update(`howwas:${jobId}`).digest("base64url");
}

export function verifyFeedbackToken(jobId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(feedbackToken(jobId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function feedbackUrl(site: string, jobId: string, rating: TripRating): string {
  const params = new URLSearchParams({ jobId, r: rating, t: feedbackToken(jobId) });
  return `${site.replace(/\/$/, "")}/api/trip-feedback?${params}`;
}

const COLOURS: Record<TripRating, string> = { great: "#2c6a4c", ok: "#8a5a00", bad: "#b8452f" };

export function howWasItEmailFor(input: {
  site: string;
  jobId: string;
  destinations: string[];
  language: Language;
}): { subject: string; html: string } {
  const t = (TRANSLATIONS[input.language] ?? TRANSLATIONS.en).howWasIt;
  const places = input.destinations.filter((d) => typeof d === "string" && d.trim()).join(" · ") || "your trip";
  const subject = t.subject.replace("{places}", places);
  const buttons = RATINGS.map(
    (r) =>
      `<a href="${escapeHtml(feedbackUrl(input.site, input.jobId, r))}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 18px;border:2px solid ${COLOURS[r]};border-radius:8px;color:${COLOURS[r]};font-weight:700;text-decoration:none">${escapeHtml(t[r])}</a>`
  ).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f1;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2b241c">
<div style="max-width:520px;margin:0 auto">
<h1 style="font-size:22px;color:#2c6a4c;margin:0 0 10px">${escapeHtml(subject)}</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 18px">${escapeHtml(t.intro.replace("{places}", places))}</p>
<div>${buttons}</div>
<p style="font-size:12px;color:#6f6557;margin-top:18px">${escapeHtml(t.why)}</p>
</div></body></html>`;
  return { subject, html };
}
