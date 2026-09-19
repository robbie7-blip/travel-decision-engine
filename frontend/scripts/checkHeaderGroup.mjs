// Every header control that has to wrap as one unit is actually inside the
// box that makes it wrap as one unit.
//
// .header-account-group (globals.css) is `display: flex; flex-wrap: nowrap`,
// and its whole job is that Sign in, the language switch, the currency
// switch and the mobile Menu button either all fit beside the logo or all
// drop to the next line together. Left as loose siblings of that box they
// wrap independently, and on a narrow screen one of them ends up alone on a
// line of its own - which is the thing the box exists to stop.
//
// This guard exists because that already happened twice, in both directions:
//
//   - The Menu button was outside the box on SEVEN of the eight pages that
//     hand-roll this header (cookies, destinations, destinations/[slug],
//     privacy, showcase, terms, why-decide). /spin had it inside, and
//     SiteHeader.tsx had it inside, so the correct shape existed in two
//     places and the other seven had quietly drifted from it. Measured at
//     390/360/320px in both languages it happened to still share a line -
//     those groups hold two controls, so there was room - so nothing looked
//     wrong and nothing would have, right up until a control or a longer
//     translated label was added.
//
//   - The currency switch was outside the box in SiteHeader.tsx, where
//     there was no room to spare: at a true 390px layout the header wrapped
//     with the EUR select alone on a line above the other three.
//
// A flex container only lays out its DIRECT children, so "inside the box"
// means direct child, not descendant - this checks for exactly that. Nesting
// one of these controls in a wrapper div silently removes it from the row's
// layout while leaving it looking grouped in the source. The one deliberate
// wrapper, .header-extra-control, is itself a direct child and is checked as
// one; what it holds is not.
//
// Nine hand-written copies of one header is the underlying problem and this
// does not fix that. It does mean the tenth cannot drift without saying so.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..");

const GROUP_CLASS = 'className="header-account-group"';

/** Controls that must be direct children of the group.
 *
 * Each entry is a substring to find and a name for the error message. For a
 * component the substring is its own opening tag; for a class the substring
 * is the class name and the tag containing it is found by backing up to its
 * "<", so a multi-line opening tag (some of these files break the language
 * switch across five lines) is matched the same as a single-line one. */
const MUST_BE_DIRECT_CHILDREN = [
  { find: "<HeaderNavToggle", label: "the mobile Menu button (HeaderNavToggle)" },
  { find: "<AccountControl", label: "the Sign in / account pill (AccountControl)" },
  { find: "lang-toggle", label: "the language switch (.lang-toggle)" },
  // Only where it appears at all: it is the currency switcher's wrapper, and
  // most pages do not render one.
  { find: "header-extra-control", label: "the currency switcher's wrapper (.header-extra-control)", optional: true },
];

/** Comments blanked out, with every index and line break left where it was.
 *
 * Needed, and found the hard way: these headers are heavily commented, and
 * the comment in SiteHeader.tsx explaining what .header-extra-control is for
 * sits ABOVE the group's opening tag. Searching raw source found the word in
 * that sentence and reported the control as rendered outside the box - the
 * same failure mode as check:stats-keys reading a semicolon inside a
 * comment. (This repo's other guard for hand-copied markup, check:mirrors,
 * compares bytes and has no such problem.)
 *
 * "//" is left alone when a ":" precedes it, so the "//" in an https:// URL
 * does not blank the rest of its line. */
function blankComments(src) {
  const keepShape = (text) => text.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, keepShape)
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before) => before + keepShape(match.slice(before.length)));
}

function tsxFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Positions of every <div> open and </div> close from `start` onwards.
 *
 * Counted as plain substrings rather than parsed: "</div>" does not contain
 * "<div" (the slash comes first), so the two never collide, and no attribute
 * value in these headers has to be understood to tell one from the other.
 * A self-closing <div ... /> would count as an open that never closes, which
 * inflates the depth and fails the check rather than passing it - the safe
 * direction, and there are none in this header. */
function divTokens(src, start) {
  const tokens = [];
  for (let i = start; i < src.length; i += 1) {
    if (src.startsWith("</div>", i)) {
      tokens.push({ index: i, open: false });
      i += 5;
    } else if (src.startsWith("<div", i)) {
      tokens.push({ index: i, open: true });
      i += 3;
    }
  }
  return tokens;
}

const problems = [];
const checked = [];

for (const file of [...tsxFilesUnder(join(FRONTEND, "app")), ...tsxFilesUnder(join(FRONTEND, "components"))]) {
  const src = blankComments(readFileSync(file, "utf8"));
  if (!src.includes(GROUP_CLASS)) continue;
  const rel = relative(FRONTEND, file);
  checked.push(rel);

  if (src.split(GROUP_CLASS).length - 1 > 1) {
    problems.push(`${rel}: renders .header-account-group more than once; this guard reads the first one only`);
    continue;
  }

  // The end of the group's own opening tag, i.e. where its contents start.
  const classAt = src.indexOf(GROUP_CLASS);
  const openEnd = src.indexOf(">", classAt);
  if (openEnd === -1) {
    problems.push(`${rel}: could not find the end of the .header-account-group opening tag`);
    continue;
  }

  // Walk out to the </div> that closes the group: the first one that would
  // take the depth below zero.
  const tokens = divTokens(src, openEnd + 1);
  let depth = 0;
  let closeIndex = -1;
  const directChildDepthAt = new Map();
  for (const token of tokens) {
    if (token.open) {
      directChildDepthAt.set(token.index, depth);
      depth += 1;
    } else {
      if (depth === 0) {
        closeIndex = token.index;
        break;
      }
      depth -= 1;
    }
  }
  if (closeIndex === -1) {
    problems.push(`${rel}: .header-account-group is never closed`);
    continue;
  }

  for (const { find, label, optional } of MUST_BE_DIRECT_CHILDREN) {
    const found = src.indexOf(find);
    if (found === -1) {
      if (!optional) {
        problems.push(
          `${rel}: renders .header-account-group but not ${label} - a header with no way ` +
            `to open the nav is a dead end on a phone`
        );
      }
      continue;
    }
    // The "<" of the tag the marker belongs to: the marker itself for a
    // component, the enclosing tag's start for a class name.
    const tagStart = find.startsWith("<") ? found : src.lastIndexOf("<", found);

    if (tagStart < openEnd) {
      problems.push(`${rel}: ${label} is rendered BEFORE .header-account-group opens, not inside it`);
      continue;
    }
    if (tagStart > closeIndex) {
      problems.push(`${rel}: ${label} is rendered AFTER .header-account-group closes, not inside it`);
      continue;
    }
    // Inside the box, but is it a direct child? Non-div tags are not in the
    // token list, so a component's tag start has to be depth-counted from
    // the div tokens before it.
    let nesting = 0;
    for (const token of tokens) {
      if (token.index >= tagStart) break;
      nesting += token.open ? 1 : -1;
    }
    const expected = find.startsWith("<") ? nesting : directChildDepthAt.get(tagStart) ?? nesting;
    if (expected !== 0) {
      problems.push(
        `${rel}: ${label} is nested ${expected} level(s) deep inside ` +
          `.header-account-group, so the group's flex row does not lay it out`
      );
    }
  }
}

if (checked.length === 0) {
  console.error("Found no file rendering .header-account-group, which cannot be right.");
  process.exit(1);
}

if (problems.length > 0) {
  console.error(".header-account-group has controls that are not in it.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nMove the control inside <div className="header-account-group"> as a direct\n` +
      `child. components/SiteHeader.tsx and app/spin/page.tsx are the reference\n` +
      `shape. A control left outside wraps on its own on a narrow screen, which\n` +
      `is the one thing that box exists to prevent.`
  );
  process.exit(1);
}

console.log(
  `Every header control is a direct child of .header-account-group ` +
    `(${checked.length} copies of this header).`
);
