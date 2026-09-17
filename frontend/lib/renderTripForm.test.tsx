// Does the flight section group by LEG?
//
// The six flight fields were six siblings of the form's own two-column
// grid, so CSS laid them out in source order and the grouping was an
// accident of how many there were: arrival date beside arrival time, then
// arrival airport beside DEPARTURE date, then departure time beside
// departure airport. The second row mixed the two halves of the journey,
// and reading down the left-hand column went arrival, arrival, departure.
//
// Why this needs a rendering test and not an eyeball: the source ORDER is
// identical before and after the fix. All six fields appear in the same
// sequence either way, so any assertion about where a label sits in the
// markup passes on the broken layout too. The only thing that actually
// changed is the nesting - one wrapper per leg - and the only way to assert
// nesting is to render the component and walk the tree.
//
// The scanner below is deliberately a dozen lines of tag counting rather
// than a DOM library. Adding jsdom to every install and every CI run to
// answer "which div is this inside" is out of proportion to the question,
// and this file is the only place that asks it.
//
// Run: npm run test:render-trip-form

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_FORM_STATE, TripForm, type TripFormState } from "../components/TripForm";
import { TRANSLATIONS } from "./i18n";
import { check, finish, heading, section } from "./testutil";

heading("the trip form's flight section");

const t = TRANSLATIONS.en;

/** The markup of one element's contents, found by class and walked with a
 * depth counter so a nested <div> cannot end the search early. Returns
 * null when the class is absent, which is itself a failure worth naming. */
function innerHtmlOfClass(html: string, className: string): string | null {
  const open = html.indexOf(`class="${className}"`);
  if (open === -1) return null;
  const start = html.indexOf(">", open);
  if (start === -1) return null;
  return sliceElement(html, start + 1);
}

/** Everything from `from` up to the </div> that closes the element it is
 * inside, counting nested <div>s on the way. */
function sliceElement(html: string, from: number): string {
  let depth = 0;
  let i = from;
  while (i < html.length) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div>", i);
    if (nextClose === -1) return html.slice(from);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
      continue;
    }
    if (depth === 0) return html.slice(from, nextClose);
    depth--;
    i = nextClose + 6;
  }
  return html.slice(from);
}

/** The immediate child <div>s of a chunk of markup, in order. */
function childDivs(inner: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    const open = inner.indexOf("<div", i);
    if (open === -1) break;
    const start = inner.indexOf(">", open);
    if (start === -1) break;
    const body = sliceElement(inner, start + 1);
    out.push(body);
    i = start + 1 + body.length;
  }
  return out;
}

function render(over: Partial<TripFormState>): string {
  const value: TripFormState = { ...DEFAULT_FORM_STATE, ...over };
  return renderToStaticMarkup(
    <TripForm value={value} onChange={() => {}} onSubmit={() => {}} submitting={false} t={t} />
  );
}

function main() {
  section("it renders at all");

  // Milan and Rome, because both have more than one airport we know - so
  // BOTH optional dropdowns are present, which is the case the old layout
  // got most wrong (six fields, three rows, every row mixed).
  const html = render({
    origin: "Sofia",
    needs_flight: false,
    destinations: "Milan, Rome",
    arrival_date: "2026-05-01",
    departure_date: "2026-05-05",
  });
  check("the form produced markup", html.length > 1000, `${html.length} chars`);
  check("the arrival date field is on the page", html.includes(t.form.arrivalDate), t.form.arrivalDate);
  check("and the departure airport dropdown", html.includes(t.form.departureAirport), t.form.departureAirport);

  section("arrival on one side, departure on the other");

  const legs = innerHtmlOfClass(html, "flight-legs");
  check("the flight fields sit in their own grid", legs !== null);

  const columns = legs === null ? [] : childDivs(legs);
  check("with exactly two columns, one per leg", columns.length === 2, `${columns.length} columns`);

  const arrival = columns[0] ?? "";
  const departure = columns[1] ?? "";

  // The whole point: each column is one leg, entire and alone. Asserted
  // both ways round - a column that contains the right fields AND one of
  // the other leg's is the old layout, which is what made the columns
  // meaningless in the first place.
  const arrivalFields: [string, string][] = [
    ["the arrival date", t.form.arrivalDate],
    ["the arrival time", t.form.arrivalTime],
    ["the arrival airport", t.form.arrivalAirport],
  ];
  const departureFields: [string, string][] = [
    ["the departure date", t.form.departureDate],
    ["the departure time", t.form.departureTime],
    ["the departure airport", t.form.departureAirport],
  ];

  for (const [label, text] of arrivalFields) {
    check(`${label} is in the first column`, arrival.includes(text), label);
    check(`${label} is NOT in the second`, !departure.includes(text), label);
  }
  for (const [label, text] of departureFields) {
    check(`${label} is in the second column`, departure.includes(text), label);
    check(`${label} is NOT in the first`, !arrival.includes(text), label);
  }

  section("and in the other language, since the labels are translated");

  {
    const bg = renderToStaticMarkup(
      <TripForm
        value={{
          ...DEFAULT_FORM_STATE,
          language: "bg",
          origin: "Sofia",
          needs_flight: false,
          destinations: "Milan",
        }}
        onChange={() => {}}
        onSubmit={() => {}}
        submitting={false}
        t={TRANSLATIONS.bg}
      />
    );
    const cols = childDivs(innerHtmlOfClass(bg, "flight-legs") ?? "");
    check("two columns in Bulgarian too", cols.length === 2, `${cols.length} columns`);
    check(
      "arrival time with the arrival date",
      (cols[0] ?? "").includes(TRANSLATIONS.bg.form.arrivalTime),
      TRANSLATIONS.bg.form.arrivalTime
    );
    check(
      "and departure time with the departure date",
      (cols[1] ?? "").includes(TRANSLATIONS.bg.form.departureTime),
      TRANSLATIONS.bg.form.departureTime
    );
  }

  section("a city with one airport still groups by leg");

  {
    // The dropdown only appears for a city with more than one airport we
    // know, so the leg's field count changes at runtime. In the old flat
    // grid that shifted every field after it by one cell; here it must
    // simply make one column shorter.
    const one = render({ origin: "Sofia", needs_flight: false, destinations: "Venice" });
    const cols = childDivs(innerHtmlOfClass(one, "flight-legs") ?? "");
    check("still two columns", cols.length === 2, `${cols.length} columns`);
    check("arrival date and time together", (cols[0] ?? "").includes(t.form.arrivalTime));
    check("departure date and time together", (cols[1] ?? "").includes(t.form.departureTime));
    check(
      "and no arrival field has leaked into the departure column",
      !(cols[1] ?? "").includes(t.form.arrivalDate)
    );
  }

  section("nothing renders when the traveler is not flying");

  {
    const noFlight = render({ origin: "Sofia", needs_flight: true, destinations: "Milan" });
    check("no flight grid", innerHtmlOfClass(noFlight, "flight-legs") === null);
    check("and no arrival date field", !noFlight.includes(t.form.arrivalDate));

    const noOrigin = render({ origin: "", needs_flight: false, destinations: "Milan" });
    check("nor without an origin", innerHtmlOfClass(noOrigin, "flight-legs") === null);
  }

  section("the grid the columns depend on is in the stylesheet");

  {
    // The nesting is half the fix; the other half is one CSS rule, in a
    // different file, that nothing in the component references by more
    // than a string. Deleting it puts all six fields in one column and no
    // test that renders markup would notice.
    const css = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "app", "globals.css"),
      "utf8"
    ) as string;
    const rule = css.slice(css.indexOf(".flight-legs {"));
    check("there is a .flight-legs rule", css.includes(".flight-legs {"));
    check("it is a grid", rule.slice(0, 200).includes("display: grid"), rule.slice(0, 120));
    check("with two columns", rule.slice(0, 200).includes("grid-template-columns: 1fr 1fr"));
    check("spanning the form's full width", rule.slice(0, 200).includes("grid-column: 1 / -1"));
    // The same breakpoint the form itself collapses at, so the two never
    // disagree about when the layout is one column.
    check(
      "and it collapses to one column on a phone",
      css.includes("@media (max-width: 560px)") && css.lastIndexOf(".flight-legs") > css.indexOf(".flight-legs {")
    );
  }

  finish();
}

main();
