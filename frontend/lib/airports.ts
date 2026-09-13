// Which airport, for the cities where it changes the itinerary.
//
// Rome is the example that makes the case. Fiumicino is ~32 km west of the
// centre with a direct 32-minute train into Termini; Ciampino is ~15 km
// southeast with no rail link at all, so it is a bus or a taxi and a
// different hour of the day gone. Landing at one and being planned for the
// other is a wrong first afternoon and a wrong last morning - and departure
// is the harder constraint of the two, because "be at the airport by nine"
// means something different from each.
//
// So this list is deliberately NOT every airport. It is the cities where a
// traveller could plausibly land at more than one and the answer changes
// the plan: Paris (Beauvais is 85 km from Paris and sold as Paris), Milan
// (Bergamo likewise), London's five, Tokyo's Narita at 60 km against
// Haneda at 15. A city with one real airport has no entry here, which is
// what makes the form show nothing rather than a dropdown with one option
// in it.
//
// What reaches the model is the LABEL, not the code alone - "Rome
// Fiumicino (FCO)" rather than "FCO" - because the label is unambiguous
// without a lookup table on the worker's side, and the worker having its
// own copy of this file is a mirror to keep in step for no gain. And it
// reaches the brief only after isKnownAirportLabel has matched it exactly,
// so what lands in the prompt is a string from this file and never
// something a caller typed.

export interface Airport {
  /** IATA code, uppercase. */
  code: string;
  /** The airport's own name, without the city. */
  name: string;
}

/** Keyed by the canonical city name. Every value has at least two entries -
 * a single-airport city belongs here only if that ever stops being true. */
const AIRPORTS_BY_CITY: Record<string, Airport[]> = {
  amsterdam: [
    { code: "AMS", name: "Schiphol" },
    // 125 km away and routinely sold as "Amsterdam" by low-cost carriers,
    // which is exactly the kind of surprise this field exists to catch.
    { code: "EIN", name: "Eindhoven" },
  ],
  bangkok: [
    { code: "BKK", name: "Suvarnabhumi" },
    { code: "DMK", name: "Don Mueang" },
  ],
  barcelona: [
    { code: "BCN", name: "El Prat" },
    { code: "GRO", name: "Girona" },
    { code: "REU", name: "Reus" },
  ],
  "buenos aires": [
    { code: "EZE", name: "Ezeiza" },
    { code: "AEP", name: "Aeroparque" },
  ],
  beijing: [
    { code: "PEK", name: "Capital" },
    { code: "PKX", name: "Daxing" },
  ],
  brussels: [
    { code: "BRU", name: "Zaventem" },
    { code: "CRL", name: "Charleroi" },
  ],
  chicago: [
    { code: "ORD", name: "O'Hare" },
    { code: "MDW", name: "Midway" },
  ],
  dubai: [
    { code: "DXB", name: "International" },
    { code: "DWC", name: "Al Maktoum" },
  ],
  frankfurt: [
    { code: "FRA", name: "Frankfurt Airport" },
    { code: "HHN", name: "Hahn" },
  ],
  istanbul: [
    { code: "IST", name: "Istanbul Airport" },
    { code: "SAW", name: "Sabiha Gokcen" },
  ],
  jakarta: [
    { code: "CGK", name: "Soekarno-Hatta" },
    { code: "HLP", name: "Halim" },
  ],
  "kuala lumpur": [
    { code: "KUL", name: "KLIA" },
    { code: "SZB", name: "Subang" },
  ],
  "los angeles": [
    { code: "LAX", name: "Los Angeles International" },
    { code: "BUR", name: "Hollywood Burbank" },
    { code: "LGB", name: "Long Beach" },
    { code: "SNA", name: "John Wayne" },
    { code: "ONT", name: "Ontario" },
  ],
  london: [
    { code: "LHR", name: "Heathrow" },
    { code: "LGW", name: "Gatwick" },
    { code: "STN", name: "Stansted" },
    { code: "LTN", name: "Luton" },
    { code: "LCY", name: "City" },
  ],
  "mexico city": [
    { code: "MEX", name: "Benito Juarez" },
    { code: "NLU", name: "Felipe Angeles" },
  ],
  milan: [
    { code: "MXP", name: "Malpensa" },
    { code: "LIN", name: "Linate" },
    { code: "BGY", name: "Bergamo Orio al Serio" },
  ],
  "new york": [
    { code: "JFK", name: "John F. Kennedy" },
    { code: "LGA", name: "LaGuardia" },
    { code: "EWR", name: "Newark" },
  ],
  osaka: [
    { code: "KIX", name: "Kansai" },
    { code: "ITM", name: "Itami" },
  ],
  oslo: [
    { code: "OSL", name: "Gardermoen" },
    { code: "TRF", name: "Torp" },
  ],
  paris: [
    { code: "CDG", name: "Charles de Gaulle" },
    { code: "ORY", name: "Orly" },
    { code: "BVA", name: "Beauvais" },
  ],
  "rio de janeiro": [
    { code: "GIG", name: "Galeao" },
    { code: "SDU", name: "Santos Dumont" },
  ],
  rome: [
    { code: "FCO", name: "Fiumicino" },
    { code: "CIA", name: "Ciampino" },
  ],
  "sao paulo": [
    { code: "GRU", name: "Guarulhos" },
    { code: "CGH", name: "Congonhas" },
  ],
  seoul: [
    { code: "ICN", name: "Incheon" },
    { code: "GMP", name: "Gimpo" },
  ],
  shanghai: [
    { code: "PVG", name: "Pudong" },
    { code: "SHA", name: "Hongqiao" },
  ],
  stockholm: [
    { code: "ARN", name: "Arlanda" },
    { code: "BMA", name: "Bromma" },
    { code: "NYO", name: "Skavsta" },
  ],
  taipei: [
    { code: "TPE", name: "Taoyuan" },
    { code: "TSA", name: "Songshan" },
  ],
  tokyo: [
    { code: "HND", name: "Haneda" },
    { code: "NRT", name: "Narita" },
  ],
  toronto: [
    { code: "YYZ", name: "Pearson" },
    { code: "YTZ", name: "Billy Bishop" },
  ],
  venice: [
    { code: "VCE", name: "Marco Polo" },
    { code: "TSF", name: "Treviso" },
  ],
  washington: [
    { code: "IAD", name: "Dulles" },
    { code: "DCA", name: "Reagan National" },
    { code: "BWI", name: "Baltimore/Washington" },
  ],
};

/** What people actually type, mapped onto the keys above.
 *
 * The destinations field is free text - it has always been - so "Roma",
 * "NYC" and "Firenze" are all real inputs. Without this the dropdown
 * simply would not appear for them, which is a worse failure than it
 * sounds: the field is silent either way, so nobody would ever find out it
 * was matching on a spelling. */
const CITY_ALIASES: Record<string, string> = {
  roma: "rome",
  nyc: "new york",
  "new york city": "new york",
  manhattan: "new york",
  londres: "london",
  londra: "london",
  parigi: "paris",
  paris_france: "paris",
  milano: "milan",
  mailand: "milan",
  venezia: "venice",
  venise: "venice",
  wien: "vienna",
  munchen: "munich",
  lisboa: "lisbon",
  firenze: "florence",
  istanbulcity: "istanbul",
  bangkokcity: "bangkok",
  "washington dc": "washington",
  "washington d.c.": "washington",
  "d.c.": "washington",
  dc: "washington",
  la: "los angeles",
  "l.a.": "los angeles",
  "ciudad de mexico": "mexico city",
  cdmx: "mexico city",
  mexico: "mexico city",
  "sao paolo": "sao paulo",
  "são paulo": "sao paulo",
  rio: "rio de janeiro",
  peking: "beijing",
  seoulcity: "seoul",
  kl: "kuala lumpur",
};

/** Folds a typed city name onto a table key.
 *
 * Diacritics are stripped rather than aliased one by one: "Zürich",
 * "München" and "São Paulo" are the same city as their unaccented
 * spellings, and a table of every accented variant is a table that will be
 * missing one. */
function canonicalCity(city: string): string {
  const folded = city
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
  return CITY_ALIASES[folded] ?? folded;
}

/** "Rome Fiumicino (FCO)" - what the traveller picks and what the prompt
 * says. City-qualified on purpose: "Fiumicino (FCO)" alone would be a
 * place name the model has to look up, and the code alone would be three
 * letters with no context in the middle of a sentence about a day plan. */
export function airportLabel(city: string, airport: Airport): string {
  const cityName = canonicalCity(city)
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `${cityName} ${airport.name} (${airport.code})`;
}

/** The airports worth choosing between for this city, or an empty list.
 *
 * Empty means "do not ask" - either the city has one airport or we do not
 * know it - and the form shows no dropdown at all. A dropdown holding a
 * single option asks the traveller a question with no answer in it. */
export function airportsFor(city: string | undefined): Airport[] {
  if (!city) return [];
  return AIRPORTS_BY_CITY[canonicalCity(city)] ?? [];
}

/** Every label this file can produce, which is the allowlist.
 *
 * These strings go into the model prompt, so the one built here is the only
 * one allowed through validation: a caller POSTing straight to /api/generate
 * cannot put its own sentence in the brief under this key. */
export function airportLabelsFor(city: string | undefined): string[] {
  const cityKey = city ? canonicalCity(city) : "";
  return airportsFor(city).map((a) => airportLabel(cityKey, a));
}

let allLabels: Set<string> | null = null;

/** Whether this is exactly a label this file produces, for any city.
 *
 * Checked against EVERY city rather than against the brief's own
 * destinations, because the two can legitimately disagree: a traveller
 * flying into Milan Bergamo for a trip whose first listed destination is
 * Como is telling the truth, and the brief is the wrong place to argue
 * with them. The allowlist is what keeps this safe - it is a closed set of
 * strings from this file either way. */
export function isKnownAirportLabel(label: string): boolean {
  if (!allLabels) {
    allLabels = new Set<string>();
    for (const [cityKey, airports] of Object.entries(AIRPORTS_BY_CITY)) {
      for (const airport of airports) {
        allLabels.add(airportLabel(cityKey, airport));
      }
    }
  }
  return allLabels.has(label);
}
