// What comes back out of this device's own storage.
//
// lib/localVisited.ts is the PRIMARY store for the visited tracker - its own
// header says so, "the source of truth for anyone who never signs in" - and
// what it read back was validated on one field of three. isValidEntry tested
// `code` and asserted the result was a VisitedEntry, so `visitedAt` and
// `pins` came back exactly as they went in, whatever that was, and the rest
// of the app then relied on the claim.
//
// The asymmetry is the thing. app/api/visited - the OPTIONAL sync path -
// validates a pin field by field and checks visitedAt against an ISO date
// pattern, with a comment saying it "only guards against garbage breaking
// storage downstream". The path that does not need an account had none of
// that, and it is the one every visitor uses.
//
// What it costs: `(e.pins ?? []).map(...)` in VisitedPinsPanel guards
// absence, not type, so a `pins` that is not an array has no `.map` and the
// Map Pins tab throws; a pin with a non-numeric lat reaches react-globe.gl
// as a point with no position; and a `visitedAt` of "soon" is what the
// Timeline and Chronology views sort and group on.
//
// Run: npm run test:local-visited

import { readLocalVisitedEntries, writeLocalVisitedEntries } from "./localVisited";
import { check, finish, heading, section } from "./testutil";

heading("this device's visited entries");

const ENTRIES_KEY = "decide:visited-entries";
const LEGACY_CODES_KEY = "decide:visited-codes";

/** The minimum localStorage this module actually uses. Node has no window,
 * so one is installed for the duration - there is no jsdom here and this
 * needs four methods. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  };
  return store;
}

const store = installStorage();

/** Puts a raw value in storage and reads it back the way a page load would. */
function roundTrip(raw: unknown): ReturnType<typeof readLocalVisitedEntries> {
  store.clear();
  store.set(ENTRIES_KEY, typeof raw === "string" ? raw : JSON.stringify(raw));
  return readLocalVisitedEntries();
}

function main() {
  {
    section("what must still come through");

    const entries = roundTrip([
      { code: "FR" },
      { code: "IT", visitedAt: "2024-07-03" },
      { code: "JP", pins: [{ id: "p1", label: "Fushimi Inari", lat: 34.967, lng: 135.778 }] },
      { code: "BG", pins: [{ id: "p2", label: "Rila", lat: 42.13, lng: 23.34, note: "go early" }] },
    ]);
    check("every real entry survives", entries.length === 4, String(entries.length));
    check("a bare code needs nothing else", entries[0].code === "FR" && entries[0].visitedAt === undefined);
    check("an ISO date is kept", entries[1].visitedAt === "2024-07-03", String(entries[1].visitedAt));
    check("a pin is kept whole", JSON.stringify(entries[2].pins) === '[{"id":"p1","label":"Fushimi Inari","lat":34.967,"lng":135.778}]', JSON.stringify(entries[2].pins));
    check("and its note with it", entries[3].pins?.[0].note === "go early", JSON.stringify(entries[3].pins));

    // The round trip this module exists for.
    store.clear();
    writeLocalVisitedEntries([{ code: "FR", visitedAt: "2024-07-03", pins: [{ id: "p1", label: "Eiffel", lat: 48.86, lng: 2.29 }] }]);
    const back = readLocalVisitedEntries();
    check("what it writes, it reads back identically", JSON.stringify(back) === JSON.stringify([{ code: "FR", visitedAt: "2024-07-03", pins: [{ id: "p1", label: "Eiffel", lat: 48.86, lng: 2.29 }] }]), JSON.stringify(back));
  }

  {
    section("pins that are not pins");

    // THE one: `pins` not an array at all. VisitedPinsPanel does
    // `(e.pins ?? []).map(...)`, which guards absence and not type.
    for (const [name, pins] of [
      ["a string", "none"],
      ["a number", 3],
      ["an object", { p1: { lat: 1, lng: 2 } }],
      ["true", true],
    ] as [string, unknown][]) {
      const entries = roundTrip([{ code: "FR", pins }]);
      check(`pins as ${name}: the country survives`, entries.length === 1 && entries[0].code === "FR", JSON.stringify(entries));
      check("  and pins is gone, not left un-mappable", entries[0].pins === undefined, JSON.stringify(entries[0].pins));
      // The property that matters: the panel's own expression cannot throw.
      let threw = false;
      try {
        (entries[0].pins ?? []).map((p) => p.lat);
      } catch {
        threw = true;
      }
      check("  so the Map Pins tab does not throw", threw === false);
    }
  }

  {
    section("pins whose coordinates are not coordinates");

    const entries = roundTrip([
      {
        code: "FR",
        pins: [
          { id: "ok", label: "Eiffel", lat: 48.86, lng: 2.29 },
          { id: "str", label: "text coords", lat: "48.86", lng: "2.29" },
          { id: "nan", label: "nan", lat: Number.NaN, lng: 2 },
          { id: "null", label: "null", lat: null, lng: 2 },
          { id: "missing", label: "missing lng", lat: 48.86 },
          { label: "no id", lat: 1, lng: 2 },
          { id: "no-label", lat: 1, lng: 2 },
          null,
          "a pin",
          42,
        ],
      },
    ]);
    check("only the real pin survives", entries[0].pins?.length === 1, JSON.stringify(entries[0].pins));
    check("  and it is the real one", entries[0].pins?.[0].id === "ok", JSON.stringify(entries[0].pins));
    check(
      "every surviving pin has finite coordinates",
      (entries[0].pins ?? []).every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
      JSON.stringify(entries[0].pins)
    );
    // A coordinate sent as text is REFUSED rather than recovered: unlike a
    // price, nothing but this app's own form ever writes one, so a string
    // there is corruption and not a typo worth rescuing.
    check("a text coordinate is not recovered", (entries[0].pins ?? []).every((p) => p.id !== "str"));

    // Long strings are capped, as they are on the wire.
    const long = roundTrip([{ code: "FR", pins: [{ id: "p", label: "x".repeat(5000), lat: 1, lng: 2, note: "y".repeat(5000) }] }]);
    check("a 5,000-character label is capped at 200", long[0].pins?.[0].label.length === 200, String(long[0].pins?.[0].label.length));
    check("and a note at 500", long[0].pins?.[0].note?.length === 500, String(long[0].pins?.[0].note?.length));
  }

  {
    section("visitedAt that is not a date");

    // The server path checks this against /^\d{4}-\d{2}-\d{2}$/ and the
    // local one did not, while the Timeline and Chronology views sort and
    // group on it.
    for (const bad of ["soon", "2024", "03/07/2024", "2024-7-3", "", 20240703, null, {}]) {
      const entries = roundTrip([{ code: "FR", visitedAt: bad }]);
      check(`visitedAt ${JSON.stringify(bad) ?? "undefined"}: the country survives`, entries.length === 1, JSON.stringify(entries));
      check("  and the date is dropped rather than sorted on", entries[0].visitedAt === undefined, String(entries[0].visitedAt));
    }
    check("a real ISO date is kept", roundTrip([{ code: "FR", visitedAt: "2024-07-03" }])[0].visitedAt === "2024-07-03");
  }

  {
    section("entries that are not entries");

    const entries = roundTrip([
      { code: "FR" },
      null,
      "IT",
      42,
      {},
      { code: 42 },
      { code: "" },
      { code: "   " },
      [],
      { code: "JP" },
    ]);
    check("only the two real entries survive", entries.length === 2, JSON.stringify(entries));
    check("and they are FR and JP", entries.map((e) => e.code).join(",") === "FR,JP", JSON.stringify(entries));

    // An unknown code is NOT dropped here, deliberately: computeVisitedStats
    // and the checklist both filter on getCountry already, and this function's
    // job is shape, not membership.
    check("an unrecognised but well-formed code is left to the stats to filter", roundTrip([{ code: "ZZ" }]).length === 1);
  }

  {
    section("storage that is not JSON");

    for (const raw of ["", "not json", "{", "null", "42", '"FR"', "{}", '{"code":"FR"}']) {
      let threw = false;
      let entries: ReturnType<typeof readLocalVisitedEntries> = [];
      try {
        entries = roundTrip(raw);
      } catch {
        threw = true;
      }
      check(`${JSON.stringify(raw)} does not throw`, threw === false);
      check("  and reads as empty", entries.length === 0, JSON.stringify(entries));
    }
  }

  {
    section("the legacy format is still migrated");

    // A bare array of codes, from before dates and pins existed. Nobody who
    // used the tracker then may lose their list.
    store.clear();
    store.set(LEGACY_CODES_KEY, JSON.stringify(["FR", "IT", 42, null, "JP"]));
    const migrated = readLocalVisitedEntries();
    check("the real codes migrate", migrated.map((e) => e.code).join(",") === "FR,IT,JP", JSON.stringify(migrated));
    check("and are written forward in the new format", store.has(ENTRIES_KEY));
    check("  so a second read does not need the legacy key", readLocalVisitedEntries().length === 3);

    store.clear();
    store.set(LEGACY_CODES_KEY, "not json");
    check("a corrupt legacy value reads as empty", readLocalVisitedEntries().length === 0);
  }

  finish();
}

main();
