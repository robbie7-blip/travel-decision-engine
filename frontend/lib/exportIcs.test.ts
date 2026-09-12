// The calendar download - a file the traveller imports into a real
// calendar app, where a malformed line means the import silently fails or
// renders as garbage.
//
// It had no test, and the line folder counted the wrong unit. RFC 5545
// §3.1 caps a content line at 75 OCTETS; foldIcsLine counted
// `line.length`, which is UTF-16 code units, while its own comment said
// octets. Two consequences, both measured rather than reasoned about:
//
//   - A Bulgarian day description came out at 135 octets in a segment
//     capped at 75, because Cyrillic is two octets per character in UTF-8.
//     This product ships a whole Bulgarian language mode, so that is the
//     normal case there - and folding exists precisely because some clients
//     reject over-long lines.
//   - `line.slice(0, 75)` split a surrogate pair whenever the boundary fell
//     inside one. A title with an emoji 74 characters in produced a lone
//     "\ud83c" at the fold, which is not encodable UTF-8: it becomes a
//     replacement character in the downloaded file.
//
// Run: npm run test:ics

import { buildItineraryIcs, foldIcsLine } from "./exportIcs";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary, ItineraryItem } from "./types";

heading("calendar export");

const enc = new TextEncoder();

/** The longest folded segment, in octets - the number RFC 5545 caps. */
const worstSegmentOctets = (folded: string): number =>
  Math.max(...folded.split("\r\n").map((seg) => enc.encode(seg).length));

/** Whether any lone surrogate survived, i.e. a split code point. */
const hasLoneSurrogate = (text: string): boolean =>
  [...text].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c >= 0xd800 && c <= 0xdfff;
  });

/** Whether encoding the result loses characters. */
const mojibake = (text: string): boolean =>
  new TextDecoder().decode(enc.encode(text)).includes("�");

/** A folded line, put back together the way a calendar client does it. */
const unfold = (folded: string): string => folded.split("\r\n ").join("");

const item = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  time: "09:00",
  type: "activity",
  title: "Morning walk",
  location: "Rome",
  cost_estimate_eur: 0,
  reasoning: "r",
  source_confidence: "inferred",
  ...over,
});

const tripOf = (items: ItineraryItem[]): Itinerary => ({
  budget_feasibility: { feasible: true, min_realistic_total_eur: 100, reasoning: "ok" },
  trip_summary: "s",
  key_decisions: [],
  things_to_skip: [],
  days: [{ day: 1, date: "2027-05-01", items, feasibility_flag: null }],
});

function main() {
  section("short lines are left alone");

  {
    check("a short line is unchanged", foldIcsLine("SUMMARY:Coffee") === "SUMMARY:Coffee");
    check("an empty line stays empty", foldIcsLine("") === "");
    const exactly75 = "A".repeat(75);
    check("exactly 75 octets is not folded", foldIcsLine(exactly75) === exactly75);
    check("76 is", foldIcsLine("A".repeat(76)).includes("\r\n "));
  }

  section("the limit is OCTETS, not characters");

  {
    // The measured defect. 75 Cyrillic characters is 150 octets; a real day
    // description came out at 135 in a single segment.
    const cyrillic = "DESCRIPTION:" + "Разходка из центъра на града с кафе и разглеждане ".repeat(3);
    const folded = foldIcsLine(cyrillic);
    check("a Cyrillic line folds within 75 octets", worstSegmentOctets(folded) <= 75, `${worstSegmentOctets(folded)} octets`);
    check("and it actually folded", folded.includes("\r\n "));
    check("unfolding restores it exactly", unfold(folded) === cyrillic);
  }

  {
    // Three-octet and four-octet code points, since the size table has four
    // branches and only the two-octet one is exercised by Cyrillic.
    const cjk = "SUMMARY:" + "東京都".repeat(40);
    check("a CJK line folds within 75 octets", worstSegmentOctets(foldIcsLine(cjk)) <= 75, `${worstSegmentOctets(foldIcsLine(cjk))} octets`);
    check("and round-trips", unfold(foldIcsLine(cjk)) === cjk);

    const emoji = "SUMMARY:" + "🎡".repeat(40);
    check("a line of 4-octet emoji folds within 75 octets", worstSegmentOctets(foldIcsLine(emoji)) <= 75, `${worstSegmentOctets(foldIcsLine(emoji))} octets`);
    check("and round-trips", unfold(foldIcsLine(emoji)) === emoji);
  }

  {
    // The continuation's leading space counts toward its own 75, so a
    // continuation may carry at most 74 octets of content.
    const long = "DESCRIPTION:" + "x".repeat(400);
    const segments = foldIcsLine(long).split("\r\n");
    check("every segment is within 75 octets", segments.every((s) => enc.encode(s).length <= 75), JSON.stringify(segments.map((s) => enc.encode(s).length)));
    check("continuations start with a space", segments.slice(1).every((s) => s.startsWith(" ")));
  }

  section("a code point is never cut in half");

  {
    // The exact reproduction: an emoji whose surrogate pair straddles index
    // 75. pad=74 was the case that produced "\ud83c" and a replacement
    // character.
    for (const padLen of [70, 71, 72, 73, 74, 75, 76]) {
      const line = "SUMMARY:" + "a".repeat(padLen - 8) + "🎡" + "b".repeat(40);
      const folded = foldIcsLine(line);
      check(`an emoji at offset ${padLen} survives the fold`, !hasLoneSurrogate(folded) && !mojibake(folded), JSON.stringify(folded.split("\r\n")[0].slice(-4)));
      check(`  and offset ${padLen} round-trips`, unfold(folded) === line);
    }
  }

  {
    // A grapheme made of several code points (a flag is two regional
    // indicators) may fall across a fold - that is valid UTF-8 and valid
    // iCalendar, and a client unfolds before rendering, so what matters is
    // that unfolding restores it.
    const flags = "SUMMARY:" + "a".repeat(70) + "🇫🇷🇯🇵🇮🇹";
    const folded = foldIcsLine(flags);
    check("a flag sequence is not corrupted", !hasLoneSurrogate(folded) && !mojibake(folded));
    check("and unfolds back to the original", unfold(folded) === flags);
  }

  section("the whole file, end to end");

  {
    const ics = buildItineraryIcs(
      tripOf([
        item({
          title: "Разглеждане на Колизеума с екскурзовод на български език",
          location: "Рим, Италия",
          reasoning: "Обиколката с екскурзовод спестява чакането на опашка и обяснява контекста накратко",
          cost_estimate_eur: 18,
        }),
      ]),
      "job-1"
    );
    const over = ics.split("\r\n").filter((l) => enc.encode(l).length > 75);
    check("no line in a Bulgarian itinerary exceeds 75 octets", over.length === 0, JSON.stringify(over.map((l) => enc.encode(l).length)));
    check("the file has no mojibake", !mojibake(ics));
    check("it is a well-formed calendar", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
    check("and contains the event", ics.includes("BEGIN:VEVENT") && ics.includes("END:VEVENT"));
  }

  {
    // Escaping is applied BEFORE folding, so an escape sequence must not be
    // split in a way that changes its meaning either.
    const ics = buildItineraryIcs(
      tripOf([item({ title: "Dinner; wine, cheese \\ more", location: "Rome, Italy", reasoning: "line one\nline two" })]),
      "job-2"
    );
    check("a semicolon is escaped", ics.includes("Dinner\\;"));
    check("a comma is escaped", ics.includes("wine\\,"));
    check("a backslash is escaped once", ics.includes("cheese \\\\ more"));
    check("a newline becomes \\n rather than a real break", ics.includes("line one\\nline two"));
  }

  {
    // The defensive cases the file already handles - asserted so they stay
    // handled, since a failed download on a paid itinerary is invisible
    // until someone tries it.
    let threw = false;
    try {
      buildItineraryIcs({ ...tripOf([]), days: undefined as never }, "job-3");
    } catch {
      threw = true;
    }
    check("an itinerary with no days does not throw", threw === false);

    threw = false;
    try {
      buildItineraryIcs({ ...tripOf([]), days: [{ day: 1, date: "2027-05-01", items: undefined as never, feasibility_flag: null }] }, "job-4");
    } catch {
      threw = true;
    }
    check("a day with no items does not throw", threw === false);

    const malformed = buildItineraryIcs(
      { ...tripOf([item()]), days: [{ day: 1, date: "not-a-date", items: [item()], feasibility_flag: null }] },
      "job-5"
    );
    check("a malformed date drops the event rather than emitting a broken one", !malformed.includes("BEGIN:VEVENT"));
    check("and still returns a valid empty calendar", malformed.startsWith("BEGIN:VCALENDAR") && malformed.includes("END:VCALENDAR"));
  }

  finish();
}

main();
