// Tests the link boundary in an Ask a Local answer.
//
// This file exists because linkify.ts is where model output becomes an
// href. Its own header claims a "javascript:" or "data:" string cannot
// reach a rendered anchor, and until this suite that claim was enforced by
// nothing: the frontend had no test runner, and CI type-checks a regex
// without caring what it matches. Loosening TOKEN to accept a bare scheme,
// or dropping the protocol check in safeHref, would have shipped green.
//
// The other half is the quieter promise: a place the local names becomes a
// search for that name, not a URL the model composed, and the prompt
// convention never reaches the traveler as punctuation.
//
// Run: npm run test:linkify

import { linkifyAnswer, mapsSearchUrl } from "./linkify";
import { check, finish, heading, section } from "./testutil";

heading("Ask a Local links");

/** The hrefs a piece of text produces, in order. */
const hrefs = (input: string, options = {}) =>
  linkifyAnswer(input, options)
    .filter((s) => s.kind === "link")
    .map((s) => (s as { href: string }).href);

/** Everything a traveler would read, links flattened back to their label. */
const rendered = (input: string, options = {}) =>
  linkifyAnswer(input, options)
    .map((s) => s.text)
    .join("");

section("what must never become a link");

for (const hostile of [
  "javascript:alert(document.cookie)",
  "JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "//evil.example.com/path",
  "mailto:someone@example.com",
]) {
  check(`no href from "${hostile.slice(0, 28)}"`, hrefs(hostile).length === 0, JSON.stringify(hrefs(hostile)));
}

check(
  "every href a real answer produces is http(s)",
  hrefs("See https://a.example.com and www.b.example.com and [[Roscioli]]").every((h) =>
    /^https?:\/\//.test(h)
  )
);

check("markup is left as text, never parsed", rendered("<script>alert(1)</script>") === "<script>alert(1)</script>");

section("URLs the model or traveler writes");

check("a plain https URL links to itself", hrefs("Hours: https://example.com/hours")[0] === "https://example.com/hours");

check(
  "a bare www gets https",
  hrefs("Also www.turismoroma.it works")[0] === "https://www.turismoroma.it/"
);

// The full stop belongs to the sentence, not the path.
check(
  "a trailing full stop is not part of the URL",
  hrefs("See https://example.com/hours.")[0] === "https://example.com/hours"
);

check(
  "the trimmed punctuation is still shown",
  rendered("See https://example.com/hours.").endsWith("."),
  rendered("See https://example.com/hours.")
);

// Wikipedia really does put brackets in paths, so a closing paren is only
// punctuation when the URL did not open one itself.
check(
  "balanced parens stay in the path",
  hrefs("Read https://en.wikipedia.org/wiki/Rome_(mythology) first")[0] ===
    "https://en.wikipedia.org/wiki/Rome_(mythology)"
);

check(
  "an unbalanced closing paren is dropped",
  hrefs("(see https://example.com/a)")[0] === "https://example.com/a",
  JSON.stringify(hrefs("(see https://example.com/a)"))
);

check("a hostname with no dot is not a URL", hrefs("http://localhost/admin").length === 0);

section("place markers");

check(
  "a marked place becomes a maps search for it",
  hrefs("Lunch at [[Roscioli]]")[0] === "https://www.google.com/maps/search/?api=1&query=Roscioli"
);

check(
  "the city is appended when the name lacks it",
  hrefs("Lunch at [[Roscioli]]", { near: "Rome" })[0] ===
    "https://www.google.com/maps/search/?api=1&query=Roscioli%20Rome"
);

check(
  "and not appended twice when it is already there",
  hrefs("[[Galleria Borghese Rome]]", { near: "Rome" })[0] ===
    "https://www.google.com/maps/search/?api=1&query=Galleria%20Borghese%20Rome"
);

check("the label is the place name, not a URL", rendered("Lunch at [[Roscioli]]") === "Lunch at Roscioli");

section("the convention never reaches the traveler");

check("an empty marker renders nothing", rendered("Empty: [[]] done") === "Empty:  done", rendered("Empty: [[]] done"));

check(
  "a nested marker degrades to plain words",
  !rendered("A nested one: [[a [[b]] c]]").includes("["),
  rendered("A nested one: [[a [[b]] c]]")
);

check(
  "an unmatched half is not shown",
  !rendered("Half open [[Roscioli and then some").includes("["),
  rendered("Half open [[Roscioli and then some")
);

section("while the answer is still streaming");

// A URL at the very end may be half-delivered, and a link that is wrong
// for one chunk is a link a traveler can tap in that chunk.
check(
  "a URL running to the end stays text mid-stream",
  hrefs("Hours are on https://example.com/ho", { streaming: true }).length === 0
);

check(
  "the same URL links once the answer is complete",
  hrefs("Hours are on https://example.com/ho", { streaming: false }).length === 1
);

check(
  "a URL mid-sentence still links mid-stream",
  hrefs("See https://example.com/hours for more", { streaming: true }).length === 1
);

// A marker CAN be split across chunks, unlike the em dash the route swaps
// per delta, which is a single code point.
check(
  "a half-arrived marker is held back rather than shown as brackets",
  rendered("Try [[Rosc", { streaming: true }) === "Try ",
  JSON.stringify(rendered("Try [[Rosc", { streaming: true }))
);

check(
  "and resolves to a link once the rest lands",
  hrefs("Try [[Roscioli]] for lunch", { streaming: true }).length === 1
);

section("mapsSearchUrl on its own");

// encodeURIComponent leaves an apostrophe alone - it is legal unencoded in
// a query - so the assertion is that spaces are encoded and the name
// itself survives intact rather than mangled.
check(
  "encodes the spaces and keeps the name intact",
  mapsSearchUrl("Sant'Eustachio Il Caffe").endsWith("query=Sant'Eustachio%20Il%20Caffe"),
  mapsSearchUrl("Sant'Eustachio Il Caffe")
);

check(
  "encodes an ampersand, which would otherwise start a new query param",
  mapsSearchUrl("Bar & Grill").endsWith("query=Bar%20%26%20Grill"),
  mapsSearchUrl("Bar & Grill")
);

check("is always an https google maps search", mapsSearchUrl("x").startsWith("https://www.google.com/maps/search/?api=1&query="));

section("ordinary answers are untouched");

const plain = "Take the metro to Termini, then walk. It is about ten minutes.";
check("no links where there are none", hrefs(plain).length === 0);
check("text survives byte for byte", rendered(plain) === plain);

finish();
