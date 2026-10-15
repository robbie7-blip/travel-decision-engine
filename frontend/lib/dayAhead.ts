// "Tomorrow's plan" - the email a traveller gets the evening before each
// day of their trip, if they asked for it.
//
// Opt-in per trip, by the signed-in account that owns it, and sent only to
// that account's own address (Job.ownerEmail, which only ever comes from
// the session). Every email carries a one-click stop link, signed so that
// nobody can turn off someone else's emails by guessing a trip id.
//
// Pure apart from the signing secret: the cron route
// (app/api/cron/day-ahead) does the reading and sending.
//
// Run: npm run test:day-ahead

import { createHmac, timingSafeEqual } from "node:crypto";
import { escapeHtml } from "./itineraryEmail";
import { TRANSLATIONS } from "./i18n";
import { affiliateIds, bookingLinkFor, stayDates } from "./bookingLinks";
import { safeHref } from "./linkify";
import type { Itinerary, Language } from "./types";

export function dayAheadKey(jobId: string): string {
  return `dayahead:${jobId}`;
}

export function dayAheadSentKey(jobId: string, date: string): string {
  return `dayahead:sent:${jobId}:${date}`;
}

/** A revision (a pushback, a hand edit, a retry) is a new trip id. When
 * the same account makes it, the evening email follows the trip to its
 * new version instead of quietly stopping. */
export async function carryDayAhead(
  redis: { get: (k: string) => Promise<unknown>; set: (k: string, v: string, o: { ex: number }) => Promise<unknown> },
  from: { id: string; ownerEmail?: string },
  to: { id: string; ownerEmail?: string; ttlSeconds: number }
): Promise<void> {
  const same = from.ownerEmail && to.ownerEmail && from.ownerEmail.trim().toLowerCase() === to.ownerEmail.trim().toLowerCase();
  if (!same) return;
  try {
    if ((await redis.get(dayAheadKey(from.id))) !== null) await redis.set(dayAheadKey(to.id), "1", { ex: to.ttlSeconds });
  } catch {
    // Best effort: losing the switch is a missed email, not a lost trip.
  }
}

/** Tomorrow's date where the travellers are. The product is European and
 * the email goes out in the evening, so Sofia's calendar is the one that
 * matters: at 19:00 there, "tomorrow" is the same date across Europe. */
export function tomorrowIso(now = new Date(), timeZone = "Europe/Sofia"): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

export function stopToken(jobId: string): string {
  return createHmac("sha256", secret()).update(`dayahead-stop:${jobId}`).digest("base64url");
}

export function verifyStopToken(jobId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(stopToken(jobId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const INK = "#2b241c";
const INK_DIM = "#6f6557";
const TEAL = "#2c6a4c";
const LINE = "#e2ddd1";

export function dayAheadEmailFor(input: {
  itinerary: Itinerary;
  date: string;
  destinations: string[];
  language: Language;
  tripUrl: string;
  stopUrl: string;
  endDate?: string;
}): { subject: string; html: string } | null {
  const days = input.itinerary.days ?? [];
  const day = days.find((d) => d.date === input.date);
  if (!day || !Array.isArray(day.items) || day.items.length === 0) return null;
  const t = TRANSLATIONS[input.language] ?? TRANSLATIONS.en;
  const copy = t.result.dayAhead;
  const places = input.destinations.filter((d) => typeof d === "string" && d.trim()).join(" · ");
  const subject = copy.subject.replace("{day}", String(day.day)).replace("{places}", places);
  const ids = affiliateIds();
  const stays = stayDates(days, input.endDate);

  const rows = day.items
    .map((item, i) => {
      const title = typeof item.title === "string" ? item.title : "";
      const time = typeof item.time === "string" ? item.time : "";
      const where = typeof item.location === "string" ? item.location : "";
      const maps = safeHref(item.google_maps_url ?? "");
      const booking = bookingLinkFor(item, stays.get(`${day.day}:${i}`), ids);
      const links = [
        maps ? `<a href="${escapeHtml(maps)}" style="color:${TEAL}">${escapeHtml(t.result.viewOnGoogleMaps)}</a>` : "",
        booking
          ? `<a href="${escapeHtml(booking.url)}" style="color:${TEAL}">${escapeHtml(
              booking.kind === "stay" ? t.result.booking.stay : t.result.booking.tickets
            )}</a>`
          : "",
      ].filter(Boolean);
      return `<tr>
<td style="padding:10px 12px 10px 0;vertical-align:top;font-size:13px;color:${INK_DIM};white-space:nowrap">${escapeHtml(time)}</td>
<td style="padding:10px 0;border-top:1px solid ${LINE}">
<div style="font-size:15px;font-weight:600;color:${INK}">${escapeHtml(title)}</div>
<div style="font-size:13px;color:${INK_DIM}">${escapeHtml(where)}</div>
${links.length ? `<div style="font-size:13px;margin-top:4px">${links.join(" · ")}</div>` : ""}
</td></tr>`;
    })
    .join("");

  // Paid activities with a named place: the things worth having a ticket
  // for before leaving the hotel.
  const tickets = day.items
    .filter((item) => item.type === "activity" && typeof item.venue_name === "string" && item.venue_name && item.cost_estimate_eur > 0)
    .map((item) => escapeHtml(item.venue_name));

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f1;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:${INK}">
<div style="max-width:560px;margin:0 auto">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${INK_DIM}">${escapeHtml(day.date)}</div>
<h1 style="font-size:22px;color:${TEAL};margin:4px 0 6px">${escapeHtml(subject)}</h1>
<p style="font-size:14px;color:${INK_DIM};margin:0 0 16px">${escapeHtml(copy.intro)}</p>
<table style="border-collapse:collapse;width:100%">${rows}</table>
${tickets.length ? `<p style="font-size:14px;margin:18px 0 0"><strong>${escapeHtml(copy.tickets)}</strong> ${tickets.join(", ")}</p>` : ""}
<p style="margin:22px 0"><a href="${escapeHtml(input.tripUrl)}" style="display:inline-block;padding:12px 18px;background:${TEAL};color:#fff;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(copy.open)}</a></p>
<p style="font-size:12px;color:${INK_DIM}">${escapeHtml(copy.why)} <a href="${escapeHtml(input.stopUrl)}" style="color:${INK_DIM}">${escapeHtml(copy.stop)}</a></p>
</div></body></html>`;

  return { subject, html };
}
