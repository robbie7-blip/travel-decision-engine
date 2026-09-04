// Attribution for the photographs in public/destinations.
//
// Those images came from Wikimedia Commons, whose licences range from
// public domain through CC BY and CC BY-SA. The CC ones REQUIRE credit:
// the photographer's name, the licence, and a link back. The images were
// committed; this manifest never was, so nothing has been crediting them.
//
// A TypeScript module rather than the JSON file the fetch script
// originally wrote, for two reasons. It is a single source of truth that
// the type checker enforces, and it can be imported by client components -
// the homepage hero and the trip cover now show these same photographs,
// and neither of them can read the filesystem.
//
// Regenerate with:
//   node scripts/recover-photo-credits.mjs
//
// That script recovers the attribution for the images already on disk and
// refuses to guess: it re-fetches each candidate from Commons and compares
// it byte for byte with the local file, so a Wikipedia page whose lead
// image has changed since the download produces a reported mismatch rather
// than a confident credit naming the wrong photographer.

export interface DestinationPhotoCredit {
  /** The file in public/destinations this credit belongs to. */
  file: string;
  artist: string;
  license: string;
  /** The Commons file page, which is where the licence text lives. */
  sourceUrl: string;
}

/** Keyed by destination slug. Empty until the recovery script has been run
 * somewhere with access to Wikimedia - see the note above. Every surface
 * that shows a destination photo renders credit when an entry exists and
 * nothing when it does not, so filling this in is purely additive. */
export const DESTINATION_PHOTO_CREDITS: Record<string, DestinationPhotoCredit> = {};
