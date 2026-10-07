// Every page has a share image, or says why not.
//
// THE FAILURE THIS CATCHES, which ran silently for a long time. Next picks
// up app/opengraph-image.tsx by file convention and injects it into pages
// that do not set `openGraph` themselves. A page that DOES set one - to
// give sharing a better description than the site-wide sentence - replaces
// the parent's openGraph object whole, image included, because metadata
// merges shallowly per field.
//
// Nothing warns. app/layout.tsx sets `twitter.card = "summary_large_image"`
// once, for everything, so an affected page does not fall back to a small
// card with a favicon: it promises a 1200x630 image and ships none.
// Measured on the built site, six pages were in that state, and the
// correlation with "declares its own openGraph" was exact.
//
// The fix is one spread - `...SHARE_CARD` from lib/shareCard.ts - which is
// exactly the kind of thing nobody remembers on the seventh page. Hence a
// guard rather than a comment.
//
// A SOURCE SCAN, not a crawl of the built site. A crawl would be the
// stronger check, and checkTouchTargets.mjs shows what that costs: a
// server to start, a browser to drive, a process group to tear down. This
// catches the authoring mistake at the moment it is made, needs no build,
// and runs in milliseconds.
//
// Run: npm run check:share-card

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const APP = join(FRONTEND, "app");

/** Pages that may ship without a share image, each with a reason.
 *
 * Only places nobody shares a link to. A page behind a sign-in or an admin
 * check is not something anyone pastes into a chat, and giving it a card
 * would be decorating a door that is locked. */
const NO_CARD_NEEDED = {
  "app/admin": "admin pages, behind an admin check and never shared",
  "app/account": "the signed-in account area, not a shareable link",
  "app/compare": "a working view of two trips, reached from a trip rather than linked to",
  "app/compare-stats": "the same, for the stats view",
};

function pagesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pagesUnder(full));
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

/** True when an opengraph-image file sits in this page's OWN directory.
 *
 * Its own, and not an ancestor's, which is the distinction the whole check
 * turns on. Verified against the built site rather than reasoned about:
 * /destinations declares its own openGraph AND has
 * app/destinations/opengraph-image.tsx, and it serves that image fine - a
 * same-segment file survives. What a declared openGraph drops is the
 * INHERITED one, which is why app/opengraph-image.tsx at the root does not
 * save anybody.
 *
 * The first version of this walked up to app/ looking for any image, found
 * the new root card from every page, and passed everything. It was caught
 * by reverting a fixed page and watching the guard stay green - which is
 * the only reason to ever run a new guard against a known-bad tree. */
function hasImageInOwnSegment(pageFile) {
  try {
    return statSync(join(dirname(pageFile), "opengraph-image.tsx")).isFile();
  } catch {
    return false;
  }
}

const problems = [];
let checked = 0;
let exempt = 0;

for (const pageFile of pagesUnder(APP)) {
  const rel = relative(FRONTEND, pageFile);
  const exemption = Object.keys(NO_CARD_NEEDED).find((prefix) => rel.startsWith(prefix));
  if (exemption) {
    exempt += 1;
    continue;
  }
  checked += 1;

  const source = readFileSync(pageFile, "utf8");
  // Only pages that declare openGraph can lose the inherited image.
  if (!/\bopenGraph\s*:/.test(source)) continue;
  // A page with an opengraph-image.tsx beside it is covered whatever its
  // metadata says.
  if (hasImageInOwnSegment(pageFile)) continue;
  if (/\.\.\.SHARE_CARD\b/.test(source) || /\bimages\s*:/.test(source)) continue;

  problems.push(rel);
}

if (problems.length > 0) {
  console.error("Pages that declare openGraph and ship no share image:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nDeclaring openGraph replaces the one inherited from app/layout.tsx, and the\n" +
      "image from app/opengraph-image.tsx goes with it - so these pages advertise\n" +
      'twitter:card "summary_large_image" with nothing to show.\n\n' +
      "Fix: spread the shared card into the openGraph block.\n\n" +
      '  import { SHARE_CARD } from "@/lib/shareCard";\n' +
      "  openGraph: { title, description, ...SHARE_CARD },\n\n" +
      "If the page genuinely should not have one - something nobody shares a link\n" +
      "to - add its directory to NO_CARD_NEEDED in this script, with the reason."
  );
  process.exit(1);
}

console.log(
  `Every shareable page has a share image (${checked} pages checked, ${exempt} exempt by name).`
);
