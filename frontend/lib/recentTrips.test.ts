// The recent-trips list, which renders inside the homepage hero.
//
// getRecentTrips did `Array.isArray(parsed) ? parsed : []` - it checked the
// container and nothing inside it. RecentTrips.tsx then renders
// `trip.destinations.join(" · ")`, so a single stored entry missing that
// field throws a TypeError DURING RENDER, in a component mounted in the
// hero. The visitor gets a blank hero with no way to know why, and it comes
// back on every load, because the bad entry is read again each time.
//
// Same shape as the exchange-rate bug two commits ago: data from a store
// that outlives deploys, rendered without being checked. And reachable
// without anyone editing anything by hand - RecentTrip is versioned by
// nothing, so the day a field is added or renamed, every returning
// visitor's existing entries are the old shape.
//
// localStorage is stubbed, so no browser.
//
// Run: npm run test:recent-trips

// Imported statically: tsx compiles these suites to CJS, so there is no
// top-level await to sequence a dynamic import behind the stub below. That
// is safe here because recentTrips.ts reads `window` INSIDE each function
// (every one opens with `typeof window === "undefined"`), never at module
// load - so hoisting the import above the stub changes nothing.
import { getRecentTrips, removeRecentTrip, saveRecentTrip } from "./recentTrips";
import { check, finish, heading, section } from "./testutil";

heading("recent trips");

const STORAGE_KEY = "decide:recentTrips";

/** A minimal localStorage, installed before the module under test reads it. */
function installStorage(): { store: Map<string, string> } {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return { store };
}

const { store } = installStorage();

const valid = (over: Record<string, unknown> = {}) => ({
  jobId: "job-1",
  destinations: ["Rome"],
  startDate: "2027-05-01",
  endDate: "2027-05-04",
  language: "en",
  savedAt: 1,
  ...over,
});

/** What the homepage hero actually does with each entry. */
function renderWouldThrow(): boolean {
  try {
    for (const trip of getRecentTrips()) {
      void trip.destinations.join(" · ");
      void `${trip.startDate} → ${trip.endDate}`;
    }
    return false;
  } catch {
    return true;
  }
}

function main() {
  section("a good list round-trips");

  {
    store.clear();
    store.set(STORAGE_KEY, JSON.stringify([valid(), valid({ jobId: "job-2", destinations: ["Rome", "Florence"] })]));
    const trips = getRecentTrips();
    check("both entries survive", trips.length === 2, String(trips.length));
    check("and render without throwing", renderWouldThrow() === false);
    check("multi-city destinations are intact", trips[1].destinations.join(",") === "Rome,Florence", trips[1].destinations.join(","));
  }

  section("the entry that blanked the hero");

  {
    // The exact defect: an entry with no destinations array.
    store.clear();
    store.set(STORAGE_KEY, JSON.stringify([{ jobId: "job-1", startDate: "a", endDate: "b" }]));
    check("an entry with no destinations is dropped", getRecentTrips().length === 0, String(getRecentTrips().length));
    check("so rendering cannot throw", renderWouldThrow() === false);
  }

  {
    // A good entry must survive alongside a bad one - dropping the whole
    // list would lose every real bookmark over one corrupt row.
    store.clear();
    store.set(STORAGE_KEY, JSON.stringify([{ jobId: "broken" }, valid({ jobId: "good" })]));
    const trips = getRecentTrips();
    check("the good entry is kept", trips.length === 1 && trips[0].jobId === "good", JSON.stringify(trips.map((t) => t.jobId)));
    check("and the broken one is not", renderWouldThrow() === false);
  }

  {
    // Every field the renderer touches.
    for (const [label, entry] of [
      ["destinations is a string", valid({ destinations: "Rome" })],
      ["destinations holds a non-string", valid({ destinations: ["Rome", 42] })],
      ["destinations is null", valid({ destinations: null })],
      ["jobId is missing", valid({ jobId: undefined })],
      ["jobId is empty", valid({ jobId: "" })],
      ["jobId is a number", valid({ jobId: 7 })],
      ["startDate is missing", valid({ startDate: undefined })],
      ["endDate is a number", valid({ endDate: 20270504 })],
    ] as [string, unknown][]) {
      store.clear();
      store.set(STORAGE_KEY, JSON.stringify([entry]));
      check(`${label} is dropped`, getRecentTrips().length === 0, JSON.stringify(getRecentTrips()));
    }
  }

  {
    // An empty destinations array is legitimate-ish and must NOT be dropped:
    // join("") on it is "", which renders as a blank label rather than a
    // crash, and the trip link itself is still useful.
    store.clear();
    store.set(STORAGE_KEY, JSON.stringify([valid({ destinations: [] })]));
    check("an empty destinations list is kept", getRecentTrips().length === 1);
    check("and renders", renderWouldThrow() === false);
  }

  section("shapes that must not throw");

  {
    for (const raw of ["", "null", "{}", "not json", "[1,2,3]", '["a"]', "[null]", "[[]]", '{"0":"a"}']) {
      store.clear();
      store.set(STORAGE_KEY, raw);
      let threw = false;
      let n = -1;
      try {
        n = getRecentTrips().length;
      } catch {
        threw = true;
      }
      check(`${JSON.stringify(raw)} does not throw`, threw === false);
      check("  and yields no trips", n === 0, String(n));
    }
  }

  {
    store.clear();
    check("an absent key yields an empty list", getRecentTrips().length === 0);
  }

  section("the cap holds on READ as well as on write");

  {
    // The write path enforces MAX_ENTRIES, but a value that got there
    // another way is not bound by it - and this list renders in the hero.
    store.clear();
    store.set(
      STORAGE_KEY,
      JSON.stringify(Array.from({ length: 50 }, (_, i) => valid({ jobId: `job-${i}` })))
    );
    check("fifty stored entries read back as at most eight", getRecentTrips().length === 8, String(getRecentTrips().length));
  }

  section("write and remove still behave");

  {
    store.clear();
    saveRecentTrip({ jobId: "a", destinations: ["Rome"], startDate: "2027-05-01", endDate: "2027-05-04", language: "en" });
    saveRecentTrip({ jobId: "b", destinations: ["Paris"], startDate: "2027-06-01", endDate: "2027-06-04", language: "en" });
    check("the newest is first", getRecentTrips()[0]?.jobId === "b", getRecentTrips()[0]?.jobId);

    saveRecentTrip({ jobId: "a", destinations: ["Rome"], startDate: "2027-05-01", endDate: "2027-05-04", language: "en" });
    const after = getRecentTrips();
    check("re-saving moves it to the front rather than duplicating", after.length === 2 && after[0].jobId === "a", JSON.stringify(after.map((t) => t.jobId)));

    removeRecentTrip("a");
    check("removing drops just that one", getRecentTrips().map((t) => t.jobId).join(",") === "b", getRecentTrips().map((t) => t.jobId).join(","));
  }

  {
    // A write that lands beside corrupt data must not carry it forward.
    store.clear();
    store.set(STORAGE_KEY, JSON.stringify([{ jobId: "broken" }]));
    saveRecentTrip({ jobId: "fresh", destinations: ["Rome"], startDate: "2027-05-01", endDate: "2027-05-04", language: "en" });
    const trips = getRecentTrips();
    check("only the valid entry remains", trips.length === 1 && trips[0].jobId === "fresh", JSON.stringify(trips.map((t) => t.jobId)));
  }

  finish();
}

main();
