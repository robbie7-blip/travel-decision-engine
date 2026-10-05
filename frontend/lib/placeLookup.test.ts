// Looking a place up by name, and what the model is told about it.
//
// This exists because of an answer a traveler actually received. Asked to
// compare two guesthouses by name, Ask a Local said "I can't actually
// browse the internet or look up live listings, reviews, or current info
// on specific properties, even by name. I only work from what's given to
// me in our conversation." The capability was configured on the
// deployment the whole time; the question simply could not reach it.
//
// The sharp edge is the difference between "we could not check" and "it
// does not exist". A quota error, a timeout or a 500 must never reach a
// traveler as "that place was not found" - someone deciding whether to
// book a room would read that as a warning about the property, which is
// the product inventing a fact about a real business.
//
// fetch is stubbed, so this runs offline with no key and no billing.
//
// Run: npm run test:place-lookup

import { describePlace, lookUpPlace, type PlaceLookupResult } from "./placeLookup";
import { check, finish, heading, section } from "./testutil";

type FetchFn = typeof globalThis.fetch;
const realFetch: FetchFn = globalThis.fetch;

/** Stands in for one Places response. */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = ((input: unknown, init?: unknown) =>
    Promise.resolve(handler(String(input), (init ?? {}) as RequestInit))) as unknown as FetchFn;
}

function placesOk(place: unknown): Response {
  return new Response(JSON.stringify({ places: place === null ? [] : [place] }), { status: 200 });
}

const FULL_PLACE = {
  displayName: { text: "Hotel Artemide" },
  formattedAddress: "Via Nazionale 22, Rome",
  rating: 4.6,
  userRatingCount: 4213,
  businessStatus: "OPERATIONAL",
  priceLevel: "PRICE_LEVEL_MODERATE",
  googleMapsUri: "https://maps.google.com/?cid=123",
  regularOpeningHours: { weekdayDescriptions: ["Monday: Open 24 hours"] },
};

async function main() {
  heading("PLACE LOOKUP - answering \"research it by name\"");

  section("a real place comes back as facts");
  {
    let sentBody = "";
    let sentMask = "";
    stubFetch((_url, init) => {
      sentBody = String(init.body ?? "");
      sentMask = String((init.headers as Record<string, string>)["X-Goog-FieldMask"] ?? "");
      return placesOk(FULL_PLACE);
    });
    const result = await lookUpPlace("k", "Hotel Artemide Rome");
    check("the status is found", result.status === "found", result.status);
    const place = result.status === "found" ? result.place : null;
    check("the name comes through", place?.name === "Hotel Artemide", place?.name);
    check("the rating comes through", place?.rating === 4.6, String(place?.rating));
    check("and how many people rated it", place?.ratingCount === 4213, String(place?.ratingCount));
    check("the address comes through", place?.address === "Via Nazionale 22, Rome", place?.address ?? "");
    check("the maps link comes through", place?.mapsUrl === "https://maps.google.com/?cid=123", place?.mapsUrl ?? "");
    check("the query is what was asked for", sentBody.includes("Hotel Artemide Rome"), sentBody);
    // One result, not twenty. This is billed per call and the answer only
    // ever quotes the first.
    check("exactly one result is requested", sentBody.includes('"maxResultCount":1'), sentBody);
    // Asking for fields we do not read is paying for them.
    check("the field mask asks for the rating", sentMask.includes("places.rating"), sentMask);
  }

  section("the difference between 'not there' and 'could not check'");
  {
    // THE assertion this file exists for. Every one of these is Google
    // failing us, and a traveler about to book must never be told the
    // property was not found because of it.
    for (const status of [429, 500, 403, 404]) {
      stubFetch(() => new Response("", { status }));
      const result = await lookUpPlace("k", "Hotel Artemide Rome");
      check(`HTTP ${status} is 'unavailable', not 'not found'`, result.status === "unavailable", result.status);
    }

    stubFetch(() => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    const timedOut = await lookUpPlace("k", "Hotel Artemide Rome");
    check("a timeout is 'unavailable' too", timedOut.status === "unavailable", timedOut.status);
    check(
      "and says why, for the log",
      timedOut.status === "unavailable" && timedOut.reason === "timeout",
      timedOut.status === "unavailable" ? timedOut.reason : ""
    );

    stubFetch(() => {
      throw new Error("socket hang up");
    });
    check("so is a thrown network error", (await lookUpPlace("k", "x")).status === "unavailable");

    // Only an empty result set is genuinely "not found".
    stubFetch(() => placesOk(null));
    check("an empty result set IS not_found", (await lookUpPlace("k", "Nowhere At All")).status === "not_found");
  }

  section("a malformed payload is read, not trusted");
  {
    // A network payload typed by assertion is not a checked one. Every
    // field here is the wrong type on purpose.
    stubFetch(() =>
      placesOk({
        displayName: "not an object",
        rating: "4.6",
        userRatingCount: null,
        formattedAddress: 42,
        regularOpeningHours: { weekdayDescriptions: "Monday" },
      })
    );
    const result = await lookUpPlace("k", "x");
    const place = result.status === "found" ? result.place : null;
    check("it does not throw", result.status === "found", result.status);
    check("a non-string name becomes empty, not 'undefined'", place?.name === "", JSON.stringify(place?.name));
    check("a string rating is dropped rather than shown", place?.rating === null, String(place?.rating));
    check("a number address is dropped", place?.address === null, String(place?.address));
    check("a non-array hours field is dropped", place?.openingHours === null, String(place?.openingHours));
  }

  section("an empty query never becomes a request");
  {
    let called = false;
    stubFetch(() => {
      called = true;
      return placesOk(FULL_PLACE);
    });
    const result = await lookUpPlace("k", "   ");
    check("no call is made", !called);
    check("and it reads as not_found", result.status === "not_found", result.status);
  }

  section("what the model is actually handed");
  {
    const found = describePlace("Hotel Artemide Rome", { status: "found", place: {
      name: "Hotel Artemide",
      address: "Via Nazionale 22, Rome",
      rating: 4.6,
      ratingCount: 4213,
      status: "OPERATIONAL",
      priceLevel: "PRICE_LEVEL_MODERATE",
      mapsUrl: "https://maps.google.com/?cid=123",
      openingHours: ["Monday: Open 24 hours"],
    } });
    check("it names the place", found.includes("Hotel Artemide"));
    check("with the rating and the sample size", found.includes("4.6") && found.includes("4213"));
    check("and the address", found.includes("Via Nazionale 22"));
    // A still-open business needs no line about it; a closed one does.
    check("an operational status is not worth a line", !found.includes("OPERATIONAL"), found);
    const closed = describePlace("x", { status: "found", place: {
      name: "Gone Cafe", address: null, rating: null, ratingCount: null,
      status: "CLOSED_PERMANENTLY", priceLevel: null, mapsUrl: null, openingHours: null,
    } });
    check("but a closed one is", closed.includes("CLOSED_PERMANENTLY"), closed);
    check("and no rating says so plainly", closed.includes("none published"), closed);

    const missing = describePlace("Nowhere", { status: "not_found" });
    check("a miss says no match", missing.includes("No Google Places match"), missing);
    // Not "this is fake". A small guesthouse legitimately may not be
    // listed, and the model is told to say which it thinks it is.
    check(
      "and offers the innocent explanation rather than implying a fake",
      missing.includes("too small or too new"),
      missing
    );

    const broken: PlaceLookupResult = { status: "unavailable", reason: "HTTP 429" };
    const unavailable = describePlace("Hotel Artemide Rome", broken);
    check("an outage says it could not be completed", unavailable.includes("could not be completed"), unavailable);
    check(
      "and tells the model in as many words not to call it missing",
      unavailable.includes("do not tell the traveler it was not found"),
      unavailable
    );
    check(
      "a traveler must never read 'no match' because Google was down",
      !unavailable.includes("No Google Places match"),
      unavailable
    );
  }

  globalThis.fetch = realFetch;
  finish();
}

void main();
