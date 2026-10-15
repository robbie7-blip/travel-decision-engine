// Attribution for the photographs in public/destinations.
//
// Commons licences range from public domain through CC BY and CC BY-SA.
// The CC ones REQUIRE credit: the photographer's name, the licence, and a
// link back - which is what every entry below carries.
//
// A TypeScript module rather than the JSON file the fetch script
// originally wrote, for two reasons. It is a single source of truth that
// the type checker enforces, and it can be imported by client components -
// the homepage hero and the trip cover now show these same photographs,
// and neither of them can read the filesystem.
//
// The European city photos were replaced in October 2026 with photos from
// Wikimedia Commons' community-reviewed "Quality images", chosen by hand
// from candidates fetched by scripts/fetch-commons-candidates.mjs. Each
// entry below was recorded from the Commons file page at download time,
// so it names the photograph actually on disk. The photos they replaced
// had no record of where they came from.
//
// The six non-European covers are from Pexels, whose licence does not
// require credit. They are listed in CREDIT_NOT_REQUIRED instead of being
// given an entry here: we do not have the photographers' names, and an
// entry would be a claim.

export interface DestinationPhotoCredit {
  /** The file in public/destinations this credit belongs to. */
  file: string;
  artist: string;
  license: string;
  /** The Commons file page, which is where the licence text lives. */
  sourceUrl: string;
}

/** Keyed by destination slug. Every surface that shows a destination photo
 * renders this credit when an entry exists. */
export const DESTINATION_PHOTO_CREDITS: Record<string, DestinationPhotoCredit> = {
  "amsterdam": {
    file: "amsterdam.jpg",
    artist: "Basile Morin",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Colorful_windows_and_canal_houses_at_blue_hour_with_water_reflection_in_Damrak_Amsterdam_Netherlands.jpg",
  },
  "athens": {
    file: "athens.jpg",
    artist: "A.Savin",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Attica_06-13_Athens_50_View_from_Philopappos_-_Acropolis_Hill.jpg",
  },
  "barcelona": {
    file: "barcelona.jpg",
    artist: "Bernard Gagnon",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Casa_Batll%C3%B3_01.jpg",
  },
  "berlin": {
    file: "berlin.jpg",
    artist: "Thomas Wolf, www.foto-tw.de",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Brandenburger_Tor_morgens.jpg",
  },
  "bruges": {
    file: "bruges.jpg",
    artist: "Dietmar Rabich",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Br%C3%BCgge_(B),_Groenerei_--_2018_--_8493-7.jpg",
  },
  "brussels": {
    file: "brussels.jpg",
    artist: "Celuici",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Grand-Place,_Brussels_-_panorama,_June_2018.jpg",
  },
  "budapest": {
    file: "budapest.jpg",
    artist: "Godot13",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:HUN-2015-Budapest-Hungarian_Parliament_(Budapest)_2015-02.jpg",
  },
  "copenhagen": {
    file: "copenhagen.jpg",
    artist: "Jakub Hałun",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Nyhavn,_Copenhagen,_20220618_1725_7350.jpg",
  },
  "florence": {
    file: "florence.jpg",
    artist: "Dllu",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Florence_Cathedral_seen_from_Piazzale_Michelangelo_night_dllu.jpg",
  },
  "lisbon": {
    file: "lisbon.jpg",
    artist: "Matti Blume",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Alfama,_Lisbon_(DSC03373).jpg",
  },
  "london": {
    file: "london.jpg",
    artist: "Dietmar Rabich",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:London,_Tower_Bridge_--_2016_--_4676.jpg",
  },
  "madrid": {
    file: "madrid.jpg",
    artist: "Carlos Delgado",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Palacio_Real_de_Madrid_-_13.jpg",
  },
  "munich": {
    file: "munich.jpg",
    artist: "Martin Falbisoner",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Frauenkirche_and_Neues_Rathaus_Munich_March_2013.JPG",
  },
  "paris": {
    file: "paris.jpg",
    artist: "Jorge Royan",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Paris_-_The_Eiffel_Tower_in_spring_-_2307.jpg",
  },
  "prague": {
    file: "prague.jpg",
    artist: "DXR",
    license: "CC BY-SA 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:North_view_of_Charles_Bridge_from_M%C3%A1nes%C5%AFv_most,_Prague_20160808_1.jpg",
  },
  "rome": {
    file: "rome.jpg",
    artist: "Diliff",
    license: "CC BY-SA 2.5",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Colosseum_in_Rome,_Italy_-_April_2007.jpg",
  },
  "venice": {
    file: "venice.jpg",
    artist: "Wolfgang Moroder",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Canal_Grande_Chiesa_della_Salute_e_Dogana_dal_ponte_dell_Accademia.jpg",
  },
  "vienna": {
    file: "vienna.jpg",
    artist: "Markus Leupold-Löwenthal",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:StateOperaViennaNightBackside.jpg",
  },
};

/** Photos whose licence does not ask for credit, and which licence that
 * is. scripts/checkCoverPhotos.mjs counts these as accounted for. */
export const CREDIT_NOT_REQUIRED: Record<string, string> = {
  "bangkok": "Pexels License",
  "dubai": "Pexels License",
  "mexico_city": "Pexels License",
  "new_york": "Pexels License",
  "singapore": "Pexels License",
  "tokyo": "Pexels License",
};
