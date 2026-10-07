// Ground transport legs: the lines that could never be verified.
//
// The owner's complaint was "47% verified". A large part of that number is
// structural rather than a quality problem: a metro ride, a taxi and a
// walk between two areas have no business for Places to look up, so
// isNamedVenueItem skips them and nothing could ever mark them checked -
// while the day prompt asks for them on every day ("getting between
// places", "ACCOUNT FOR THE WHOLE DAY"). The product told the model to
// write lines it would then count against itself.
//
// The fix is the one already proven on flights: build a real, checkable
// link deterministically from the route. No model call, no generation
// time.
//
// What this suite is actually guarding is the FALSE LINK. A directions URL
// between the wrong two places is worse than none - it is a verification
// claim the product is not entitled to make, pointing the traveler at the
// wrong part of the city. So most of what follows is cases where the
// answer must be no link at all.
//
// Run: npm run test:directions

import { attachDirectionsLinks } from "./engine/directionsLinks";
import { groundedRatio } from "./engine/quality";
import { check, finish, heading, section } from "./testutil";
import type { Itinerary, ItineraryDay, ItineraryItem, TripBriefInput } from "./types";

function brief(over: Partial<TripBriefInput> = {}): TripBriefInput {
  return {
    destinations: ["Rome"],
    origin: "Sofia",
    start_date: "2027-03-18",
    end_date: "2027-03-19",
    party_size: 2,
    party_composition: "couple",
    budget_total_eur: 2000,
    pace: "moderate",
    interests: ["food"],
    must_see: [],
    dietary_constraints: [],
    mobility_constraints: [],
    hard_no: [],
    language: "en",
    needs_lodging: true,
    needs_flight: true,
    ...over,
  };
}

function item(over: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    time: "10:00",
    type: "activity",
    title: "Something",
    venue_name: "Some Place",
    location: "Centro Storico, Rome",
    cost_estimate_eur: 10,
    reasoning: "r",
    source_confidence: "inferred",
    ...over,
  };
}

/** A ground leg as the model really writes one.
 *
 * `location` is a REQUIRED string on ItineraryItem, so a leg always
 * carries one and it describes the journey rather than a destination.
 * An earlier version of this fixture set it to null, which TypeScript
 * rejected - and that rejection was right about more than the type: with
 * a realistic leg, an endpoint search that did not exclude transport
 * would route one leg to another leg's description. */
function leg(over: Partial<ItineraryItem> = {}): ItineraryItem {
  return item({
    type: "transport",
    title: "Metro to Trastevere",
    venue_name: null,
    location: "Rome",
    cost_estimate_eur: 2,
    ...over,
  });
}

function trip(items: ItineraryItem[]): Itinerary {
  const day: ItineraryDay = { day: 1, date: "2027-03-18", items, feasibility_flag: null };
  return {
    budget_feasibility: { feasible: true, min_realistic_total_eur: 600, reasoning: "r" },
    trip_summary: "s",
    key_decisions: [],
    days: [day],
    things_to_skip: [],
  };
}

/** The link on the one transport item in `items`, after attaching. */
function linkFor(items: ItineraryItem[], b: TripBriefInput = brief()): string | undefined {
  const itinerary = attachDirectionsLinks(trip(items), b);
  return itinerary.days[0].items.find((i) => i.type === "transport")?.directions_url;
}

/** A query parameter, read the way a browser reads it.
 *
 * Not decodeURIComponent on the whole URL: URLSearchParams encodes a space
 * as "+", which decodeURIComponent leaves as a literal plus, so a
 * substring check against the readable text fails on a link that is
 * perfectly correct. Three assertions in this file did exactly that and
 * reported the code broken when it was not. searchParams is what actually
 * opens the link. */
function param(url: string | undefined, name: string): string | null {
  if (!url) return null;
  return new URL(url).searchParams.get(name);
}

async function main() {
  heading("GROUND TRANSPORT - a real route instead of an unverifiable line");

  section("a leg between two named places becomes a route");
  {
    const url = linkFor([
      item({ venue_name: "Pantheon", location: "Centro Storico, Rome", time: "10:00" }),
      leg({ time: "12:00" }),
      item({ venue_name: "Trattoria Da Enzo", location: "Trastevere, Rome", time: "13:00" }),
    ]);
    check("a link is attached", Boolean(url), String(url));
    check("it is a Google Maps directions URL", (url ?? "").startsWith("https://www.google.com/maps/dir/?"), url);
    check(
      "the origin is where they actually were",
      param(url, "origin") === "Pantheon, Centro Storico, Rome",
      param(url, "origin") ?? "(none)"
    );
    check(
      "the destination is where they are actually going",
      param(url, "destination") === "Trattoria Da Enzo, Trastevere, Rome",
      param(url, "destination") ?? "(none)"
    );
  }

  section("the cases where the honest answer is no link");
  {
    // A verification claim this file is not entitled to make. A link
    // opening Maps on the wrong pair of places is worse for the traveler
    // than no link, AND it would count toward the trust score.
    check(
      "a leg with nothing before it is left alone",
      linkFor([leg({ time: "07:00" }), item({ venue_name: "Pantheon", time: "10:00" })]) === undefined
    );
    check(
      "a leg with nothing after it is left alone",
      linkFor([item({ venue_name: "Pantheon", time: "10:00" }), leg({ time: "22:00" })]) === undefined
    );
    check(
      "a leg between two items at the same place is left alone",
      linkFor([
        item({ venue_name: "Pantheon", location: "Centro Storico, Rome", time: "10:00" }),
        leg({ time: "11:00" }),
        item({ venue_name: "Pantheon", location: "Centro Storico, Rome", time: "12:00" }),
      ]) === undefined
    );
    check(
      "a day with nothing named at all gets nothing",
      linkFor([
        item({ venue_name: null, location: "", time: "10:00" }),
        leg({ time: "11:00" }),
        item({ venue_name: null, location: "   ", time: "12:00" }),
      ]) === undefined
    );
    // The leg's own location is not an endpoint for anything, including
    // itself. It describes the journey ("Rome", "Fiumicino", "Rome to
    // Ubud"), and routing to it would be a confident wrong answer.
    check(
      "a leg's own location is never used as an endpoint",
      linkFor([
        leg({ time: "09:00", location: "Termini, Rome" }),
        leg({ time: "11:00" }),
        leg({ time: "12:00", location: "Trastevere, Rome" }),
      ]) === undefined
    );
    // An item with only a location and no venue is still somewhere a
    // person can be dropped off, so it counts as an endpoint.
    check(
      "but a location with no venue name is still a place",
      Boolean(
        linkFor([
          item({ venue_name: null, location: "Termini, Rome", time: "10:00" }),
          leg({ time: "11:00" }),
          item({ venue_name: null, location: "Trastevere, Rome", time: "12:00" }),
        ])
      )
    );
  }

  section("the airport transfers, which had no route at all");
  {
    // The two legs a traveler most wants directions for were the only ones
    // without them: the arrival taxi is the first item of the trip so
    // nothing precedes it, and the final transfer is the last so nothing
    // follows. Both now borrow the airport the brief names.
    const b = brief({ arrival_airport: "Rome Ciampino (CIA)", departure_airport: "Rome Ciampino (CIA)" });
    const arrivalUrl = linkFor(
      [
        leg({ time: "16:30", title: "Taxi from Ciampino to the hotel", location: "Ciampino" }),
        item({ venue_name: "Hotel Artemide", location: "Via Nazionale, Rome", time: "17:30" }),
      ],
      b
    );
    check("the arrival transfer gets a route", Boolean(arrivalUrl), String(arrivalUrl));
    check(
      "starting at the airport the brief named",
      (param(arrivalUrl, "origin") ?? "").includes("Ciampino"),
      param(arrivalUrl, "origin") ?? "(none)"
    );
    check(
      "and ending where they are actually going",
      (param(arrivalUrl, "destination") ?? "").startsWith("Hotel Artemide"),
      param(arrivalUrl, "destination") ?? "(none)"
    );

    const departureUrl = linkFor(
      [
        item({ venue_name: "Hotel Artemide", location: "Via Nazionale, Rome", time: "07:00" }),
        leg({ time: "08:00", title: "Transfer to the airport", location: "Rome" }),
      ],
      b
    );
    check(
      "the departure transfer ends at the airport",
      (param(departureUrl, "destination") ?? "").includes("Ciampino"),
      param(departureUrl, "destination") ?? "(none)"
    );

    // Still refused when the brief says nothing. An invented airport is
    // the wrong-route failure this file is mostly about.
    check(
      "no airport on the brief means no link, as before",
      linkFor(
        [
          leg({ time: "16:30", title: "Taxi in from somewhere" }),
          item({ venue_name: "Hotel Artemide", location: "Rome", time: "17:30" }),
        ],
        brief()
      ) === undefined
    );
    // A MIDDLE day's first leg is not an arrival, so it must not be handed
    // the airport - that would route a morning metro ride from Ciampino.
    const itinerary = attachDirectionsLinks(
      {
        budget_feasibility: { feasible: true, min_realistic_total_eur: 600, reasoning: "r" },
        trip_summary: "s",
        key_decisions: [],
        things_to_skip: [],
        days: [
          { day: 1, date: "2027-03-18", items: [item({ venue_name: "A", location: "Rome" })], feasibility_flag: null },
          {
            day: 2,
            date: "2027-03-19",
            items: [
              leg({ time: "09:00", title: "Metro across town" }),
              item({ venue_name: "Pantheon", location: "Centro, Rome", time: "10:00" }),
            ],
            feasibility_flag: null,
          },
          { day: 3, date: "2027-03-20", items: [item({ venue_name: "C", location: "Rome" })], feasibility_flag: null },
        ],
      },
      b
    );
    check(
      "a middle day's opening leg is left alone",
      itinerary.days[1].items[0].directions_url === undefined,
      itinerary.days[1].items[0].directions_url ?? "(none)"
    );
  }

  section("a flight is not a drive");
  {
    const itinerary = attachDirectionsLinks(
      trip([
        item({ venue_name: "Hotel Sofia", location: "Sofia", time: "06:00" }),
        leg({ time: "07:00", title: "Flight to Rome", is_flight: true }),
        item({ venue_name: "Pantheon", location: "Centro Storico, Rome", time: "14:00" }),
      ]),
      brief()
    );
    const flight = itinerary.days[0].items.find((i) => i.is_flight);
    // Routing Sofia to Rome as a drive, and counting it as verification,
    // would be a confident wrong answer on the most expensive line of the
    // trip. Flights have their own link - see flightLinks.ts.
    check("a flight gets no driving route", flight?.directions_url === undefined, flight?.directions_url);
  }

  section("two legs in a row, which is a normal day");
  {
    // Walk to the metro, then the metro. The first leg's neighbour is the
    // second leg, which is not a place - so the search has to walk past it
    // rather than giving up or routing to a transport line.
    const itinerary = attachDirectionsLinks(
      trip([
        item({ venue_name: "Pantheon", location: "Centro Storico, Rome", time: "10:00" }),
        leg({ time: "11:00", title: "Walk to Barberini", location: "Barberini, Rome" }),
        leg({ time: "11:15", title: "Metro line A", location: "Metro line A" }),
        item({ venue_name: "Galleria Borghese", location: "Pinciano, Rome", time: "12:00" }),
      ]),
      brief()
    );
    const legs = itinerary.days[0].items.filter((i) => i.type === "transport");
    check("both legs are linked", legs.length === 2 && legs.every((l) => Boolean(l.directions_url)));
    check(
      "and both route between the real endpoints, not to each other",
      legs.every(
        (l) =>
          (param(l.directions_url, "origin") ?? "").startsWith("Pantheon") &&
          (param(l.directions_url, "destination") ?? "").startsWith("Galleria Borghese")
      ),
      legs.map((l) => l.directions_url).join(" | ")
    );
  }

  section("how they said they want to get around");
  {
    const items = () => [
      item({ venue_name: "Pantheon", location: "Centro Storico, Rome", time: "10:00" }),
      leg({ time: "11:00" }),
      item({ venue_name: "Trattoria Da Enzo", location: "Trastevere, Rome", time: "13:00" }),
    ];
    check(
      "public transit asks Maps for transit",
      (linkFor(items(), brief({ transport_preference: "public_transit" })) ?? "").includes("travelmode=transit")
    );
    check(
      "taxi asks for driving",
      (linkFor(items(), brief({ transport_preference: "taxi_rideshare" })) ?? "").includes("travelmode=driving")
    );
    check(
      "walking asks for walking",
      (linkFor(items(), brief({ transport_preference: "walking" })) ?? "").includes("travelmode=walking")
    );
    // Not guessing on their behalf: no stated preference, no mode, and
    // Maps picks for itself.
    check(
      "no stated preference means no mode is forced",
      !(linkFor(items(), brief()) ?? "").includes("travelmode")
    );
  }

  section("a trip written in Bulgarian gets the same links");
  {
    // The bug flightLinks.ts documents: an implementation that reads the
    // leg's own text ("от Фиумичино до Рим") and splits on the English
    // word "to" silently never matches, and no Bulgarian trip ever gets a
    // link. The endpoints come from the items either side instead, which
    // is structure the trip has in every language.
    const url = linkFor(
      [
        item({ venue_name: "Пантеон", location: "Центро Сторико, Рим", time: "10:00", title: "Разходка" }),
        leg({ time: "11:00", title: "Метро до Трастевере" }),
        item({ venue_name: "Да Енцо", location: "Трастевере, Рим", time: "13:00", title: "Обяд" }),
      ],
      brief({ language: "bg" })
    );
    check("a Bulgarian trip gets a link", Boolean(url), String(url));
    check(
      "with its own places in it",
      (param(url, "origin") ?? "").includes("Пантеон"),
      param(url, "origin") ?? "(none)"
    );
  }

  section("the link is built, not concatenated");
  {
    // A venue name with a space, an ampersand or a quote in it has to
    // survive into a URL that still means the same thing.
    const url = linkFor([
      item({ venue_name: "Bar & Grill \"Roma\"", location: "Centro, Rome", time: "10:00" }),
      leg({ time: "11:00" }),
      item({ venue_name: "Café Déjà Vu", location: "Trastevere, Rome", time: "13:00" }),
    ]);
    check("no raw ampersand breaks the query", (url ?? "").split("&").length === 3, url);
    check(
      "and the name survives a round trip",
      param(url, "origin") === 'Bar & Grill "Roma", Centro, Rome',
      param(url, "origin") ?? "(none)"
    );
  }

  section("an existing link is never overwritten");
  {
    const itinerary = attachDirectionsLinks(
      trip([
        item({ venue_name: "Pantheon", time: "10:00" }),
        leg({ time: "11:00", directions_url: "https://example.com/already" }),
        item({ venue_name: "Trattoria Da Enzo", location: "Trastevere, Rome", time: "13:00" }),
      ]),
      brief()
    );
    check(
      "a link set upstream stays",
      itinerary.days[0].items.find((i) => i.type === "transport")?.directions_url ===
        "https://example.com/already"
    );
  }

  section("what it actually does to the number");
  {
    // The point of the whole change. Same itinerary, scored before and
    // after - with every venue left unverified, so the ONLY thing moving
    // is the transport legs.
    const items = [
      item({ venue_name: "Pantheon", location: "Centro Storico, Rome", time: "10:00" }),
      leg({ time: "11:00" }),
      item({ venue_name: "Trattoria Da Enzo", location: "Trastevere, Rome", time: "13:00" }),
      leg({ time: "15:00", title: "Tram to Testaccio" }),
      item({ venue_name: "Mercato Testaccio", location: "Testaccio, Rome", time: "16:00" }),
    ];
    const before = groundedRatio(trip(items.map((i) => ({ ...i }))));
    const after = groundedRatio(attachDirectionsLinks(trip(items.map((i) => ({ ...i }))), brief()));
    check("nothing was grounded before", before.groundedPercent === 0, `${before.groundedPercent}%`);
    check(
      "the two legs now count, and only the two legs",
      after.groundedPercent === 40,
      `${after.groundedPercent}% of ${after.itemCount} items`
    );
  }

  finish();
}

void main();
