// The itinerary as an email.
//
// There was already a way to get a trip off the screen and into the rest
// of your life - an .ics export and a print stylesheet - but no way to
// just send it to yourself, despite Resend being wired up for sign-in
// links and the address on the account being a verified one.
//
// ESCAPING IS THE WHOLE RISK HERE, and it is not theoretical. Every string
// in an itinerary is written by the MODEL: titles, locations, the
// reasoning behind each line. Interpolating those into HTML unescaped is
// the same class of bug the verify route already carries a comment about
// (a token that closed its own <script> and ran as one). An email client
// is a different renderer with different rules, but the fix is the same
// and it belongs here, once, rather than at each interpolation.
//
// Plain HTML with inline hex colours, not the app's CSS: mail clients
// strip <style>, strip custom properties, and Outlook will not lay out
// flex. The hex values match lib/email.ts's, which notes that they are
// hand-kept copies of the palette for the same reason.
//
// Run: npm run test:itinerary-email

import { TRANSLATIONS } from "./i18n";
import type { Itinerary, Language } from "./types";

/** HTML-escapes one string.
 *
 * Covers the five characters that matter, including both quote styles:
 * these values land inside attributes as well as text, and a title
 * carrying a double quote would otherwise end one early. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INK = "#2b241c";
const INK_SOFT = "#4a4136";
const INK_DIM = "#6f6557";
const TEAL = "#2c6a4c";
const LINE = "#e2ddd1";

export interface ItineraryEmail {
  subject: string;
  html: string;
}

export function itineraryEmailFor(input: {
  itinerary: Itinerary;
  /** Absolute URL of the trip page, for the one link in the email. */
  tripUrl: string;
  destinations: string[];
  language: Language;
}): ItineraryEmail {
  const t = TRANSLATIONS[input.language] ?? TRANSLATIONS.en;
  const copy = t.result.emailTrip;
  const where = input.destinations.filter((d) => typeof d === "string" && d.trim() !== "").join(" · ");

  const days = (input.itinerary?.days ?? []).filter(Boolean);

  const dayBlocks = days
    .map((day) => {
      const items = (day?.items ?? [])
        .filter(Boolean)
        .map((item) => {
          const time = escapeHtml(item?.time ?? "");
          const title = escapeHtml(item?.title ?? "");
          const place = escapeHtml(item?.location ?? "");
          return `
            <tr>
              <td style="padding: 6px 12px 6px 0; vertical-align: top; white-space: nowrap; font-size: 13px; color: ${INK_DIM};">${time}</td>
              <td style="padding: 6px 0; vertical-align: top; font-size: 14px; color: ${INK};">
                ${title}${place ? `<div style="font-size: 12px; color: ${INK_DIM};">${place}</div>` : ""}
              </td>
            </tr>`;
        })
        .join("");

      return `
        <div style="margin: 0 0 22px;">
          <div style="font-size: 15px; font-weight: 700; color: ${INK}; border-bottom: 1px solid ${LINE}; padding-bottom: 6px; margin-bottom: 6px;">
            ${escapeHtml(t.result.day)} ${escapeHtml(String(day?.day ?? ""))}
            <span style="font-weight: 400; color: ${INK_DIM}; font-size: 13px;">${escapeHtml(day?.date ?? "")}</span>
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">${items}</table>
        </div>`;
    })
    .join("");

  const summary = escapeHtml(input.itinerary?.trip_summary ?? "");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 620px; margin: 0 auto; padding: 32px 24px; color: ${INK};">
      <div style="font-size: 22px; font-weight: 700; color: ${TEAL}; margin-bottom: 24px;">decide</div>
      <h1 style="font-size: 19px; font-weight: 600; margin: 0 0 6px; color: ${INK};">${escapeHtml(where)}</h1>
      ${summary ? `<p style="font-size: 14px; line-height: 1.6; color: ${INK_SOFT}; margin: 0 0 24px;">${summary}</p>` : ""}
      ${dayBlocks}
      <p style="font-size: 13px; line-height: 1.6; color: ${INK_SOFT}; margin: 24px 0 0;">
        <a href="${escapeHtml(input.tripUrl)}" style="color: ${TEAL}; font-weight: 600;">${escapeHtml(copy.viewOnline)}</a>
      </p>
      <p style="font-size: 12px; line-height: 1.6; color: ${INK_DIM}; margin: 16px 0 0;">${escapeHtml(copy.footer)}</p>
    </div>`;

  return {
    // Not escaped: a subject is a header, not HTML, and escaping it would
    // put "&amp;" in somebody's inbox.
    subject: copy.subject.replace("{trip}", where || copy.subjectFallback),
    html,
  };
}
