// The itinerary as an email, and the one thing that must not go wrong.
//
// EVERY STRING IN AN ITINERARY IS WRITTEN BY THE MODEL: titles,
// locations, the reasoning behind each line. Interpolating those into
// HTML unescaped is the same class of bug app/api/auth/verify already
// carries a comment about - a value that closed its own <script> and ran
// as one. A mail client is a different renderer with different rules, and
// "it is only an email" is not a defence: HTML mail executes nothing in a
// modern client, but it absolutely renders injected markup, and an
// itinerary line that can rewrite the message around it can forge the
// link the message exists to carry.
//
// So the first section here is adversarial, and it checks the ABSENCE of
// raw markup rather than the presence of entities - the test somebody
// writes by hand tends to assert the escaped form of the one character
// they thought of.
//
// Run: npm run test:itinerary-email

import { escapeHtml, itineraryEmailFor } from "./itineraryEmail";
import { TRANSLATIONS } from "./i18n";
import type { Itinerary } from "./types";
import { check, finish, heading, section } from "./testutil";

heading("the itinerary as an email");

const tripOf = (over: Partial<Itinerary> = {}): Itinerary =>
  ({
    trip_summary: "Three days in Rome.",
    budget_feasibility: { feasible: true, min_realistic_total_eur: 1500, note: "" },
    key_decisions: [],
    things_to_skip: [],
    days: [
      {
        day: 1,
        date: "2027-05-01",
        feasibility_flag: null,
        items: [{ time: "09:30", title: "Colosseum", location: "Piazza del Colosseo 1" }],
      },
    ],
    ...over,
  }) as unknown as Itinerary;

const build = (over: Partial<Itinerary> = {}, destinations = ["Rome"]) =>
  itineraryEmailFor({ itinerary: tripOf(over), tripUrl: "https://yourdecide.com/trip/abc", destinations, language: "en" });

section("model-written content cannot inject markup");

{
  const nasty = tripOf({
    trip_summary: `<script>alert(1)</script> and "quotes" & <b>bold</b>`,
    days: [
      {
        day: 1,
        date: `2027-05-01"><img src=x onerror=alert(1)>`,
        feasibility_flag: null,
        items: [
          { time: `09:30" onmouseover="alert(1)`, title: `</a><a href="https://evil.example">Click</a>`, location: `<iframe src="https://evil.example"></iframe>` },
        ],
      } as never,
    ],
  } as Partial<Itinerary>);
  const { html } = itineraryEmailFor({ itinerary: nasty, tripUrl: "https://yourdecide.com/trip/abc", destinations: ["Rome"], language: "en" });

  check("no <script> survives", !/<script/i.test(html), html.slice(0, 160));
  check("no <iframe> survives", !/<iframe/i.test(html));
  check("no injected <img> survives", !/<img/i.test(html));
  // NOT "the word onerror does not appear" - that was the first version
  // of these two and it was wrong. The payload survives as escaped TEXT,
  // so the word is present and visible, which is exactly what the last
  // check in this section asks for. What must not exist is an event
  // handler inside a REAL tag, so that is what is asserted: every actual
  // element in the output, inspected for an on*= attribute.
  const realTags = html.match(/<[a-zA-Z][^>]*>/g) ?? [];
  const withHandlers = realTags.filter((tag) => /\son[a-z]+\s*=/i.test(tag));
  check("no element carries an event handler", withHandlers.length === 0, withHandlers.join(" "));
  check("and there are real tags to have checked", realTags.length > 5, String(realTags.length));
  // The one that matters most: the email's whole job is carrying a link.
  check("no second <a href> was injected", (html.match(/<a /g) ?? []).length === 1, String((html.match(/<a /g) ?? []).length));
  check("and the surviving link is ours", /href="https:\/\/yourdecide\.com\/trip\/abc"/.test(html));
  check("the payload is still VISIBLE, as text", html.includes("&lt;script&gt;"), "escaped form missing");
}

section("the escaper itself");

{
  check("& first, or the rest double-escape", escapeHtml("&lt;") === "&amp;lt;", escapeHtml("&lt;"));
  check("angle brackets", escapeHtml("<b>") === "&lt;b&gt;");
  check("both quote styles", escapeHtml(`"x" 'y'`) === "&quot;x&quot; &#39;y&#39;");
  check("null and undefined are empty, not the word", escapeHtml(null) === "" && escapeHtml(undefined) === "");
  check("a number survives", escapeHtml(7) === "7");
}

section("the subject");

{
  check("names the trip", build().subject === "Your trip: Rome", build().subject);
  check("joins multiple cities", build({}, ["Rome", "Florence"]).subject.includes("Rome · Florence"), build({}, ["Rome", "Florence"]).subject);
  check("falls back when there are none", build({}, []).subject === "Your trip: your itinerary", build({}, []).subject);
  check("drops blanks rather than joining empties", build({}, ["Rome", "", "  "]).subject === "Your trip: Rome", build({}, ["Rome", "", "  "]).subject);
  // A subject is a header, not HTML - escaping it would put &amp; in an
  // inbox.
  check("is NOT html-escaped", build({}, ["Nice & Cannes"]).subject.includes("Nice & Cannes"), build({}, ["Nice & Cannes"]).subject);
}

section("the body");

{
  const { html } = build();
  check("carries the summary", html.includes("Three days in Rome."));
  check("the day", html.includes("2027-05-01"));
  check("the time", html.includes("09:30"));
  check("the item", html.includes("Colosseum"));
  check("the place", html.includes("Piazza del Colosseo 1"));
  check("and exactly one link, to the trip", (html.match(/<a /g) ?? []).length === 1);
  check("no CSS custom properties, which mail clients strip", !html.includes("var(--"), "found var(--");
  check("no <style> block, which they also strip", !/<style/i.test(html));
}

section("the reading language");

{
  const bg = itineraryEmailFor({ itinerary: tripOf(), tripUrl: "https://yourdecide.com/trip/abc", destinations: ["Рим"], language: "bg" });
  check("a Bulgarian trip gets a Bulgarian subject", bg.subject.startsWith(TRANSLATIONS.bg.result.emailTrip.subject.split("{")[0]), bg.subject);
  check("and a Bulgarian footer", bg.html.includes(TRANSLATIONS.bg.result.emailTrip.footer.slice(0, 20)));
  const odd = itineraryEmailFor({ itinerary: tripOf(), tripUrl: "x", destinations: ["Rome"], language: "de" as never });
  check("an unknown language falls back to English rather than throwing", odd.subject.startsWith("Your trip"), odd.subject);
}

section("half-written itineraries");

{
  let threw = false;
  try {
    for (const days of [undefined, null, [], [null, undefined], [{ items: null }], [{ items: [null, {}] }]]) {
      itineraryEmailFor({
        itinerary: { days } as unknown as Itinerary,
        tripUrl: "https://yourdecide.com/trip/abc",
        destinations: ["Rome"],
        language: "en",
      });
    }
  } catch {
    threw = true;
  }
  check("none of them throw", threw === false);
}

finish();
