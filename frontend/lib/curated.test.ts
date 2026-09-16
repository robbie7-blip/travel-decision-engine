// The two admin-curated surfaces: the homepage demo trip and the /showcase
// gallery.
//
// Both are real trips, deliberately - "this app's whole pitch is 'grounded,
// not fabricated,' so a fake demo would undermine the one claim it exists to
// prove" - and both read a stored record with an unguarded `JSON.parse` and
// an unvalidated `as`. Four call sites, the same two lines each.
//
// THE SHOWCASE ONE IS PUBLIC. loadShowcaseCards did
// `raw.map((r) => typeof r === "string" ? JSON.parse(r) as ShowcaseTrip : r)`
// - a parse inside a map - and then the page rendered
// `card.destinations.join(" · ")`. Measured, with ONE bad entry among good
// ones:
//
//   one truncated entry        -> THREW: Unexpected end of JSON input
//   one non-JSON entry         -> THREW: Unexpected token 'o'
//   destinations as a string   -> THREW: entry.destinations.join is not a function
//   destinations missing       -> THREW: Cannot read properties of undefined
//   entry is null              -> THREW: Cannot read properties of null
//
// Not the bad card - the WHOLE gallery, on an unauthenticated marketing
// page, for as long as the entry sits in an admin-written list nobody would
// think to look at.
//
// The demo one 500s /api/demo-trip, which the homepage calls, where the
// feature's own argument is that a demo which cannot be shown is not shown:
// "the homepage simply doesn't show the link rather than making one up or
// showing a dead one." A 500 is the third thing that design rules out.
//
// Run: npm run test:curated

import { readDemoTrip } from "./demoTrip";
import { readFeedbackEntry, readFeedbackList, type FeedbackEntry } from "./feedback";
import { readShowcaseList, readShowcaseTrip } from "./showcase";
import { check, finish, heading, section } from "./testutil";

heading("the curated demo trip and showcase gallery");

const goodTrip = { jobId: "job-abc", destinations: ["Rome", "Florence"], addedAt: 1_700_000_000_000 };
const goodDemo = { jobId: "job-abc", destinations: ["Rome"], setAt: 1_700_000_000_000 };

/** What the page does with the list, now that it cannot throw. */
function labels(raw: unknown[]): string[] {
  return readShowcaseList(raw).map((t) => t.destinations.join(" · "));
}

function main() {
  {
    section("what must still be read");

    // Both storage shapes: Upstash auto-deserializes JSON-looking strings,
    // so a value written as JSON comes back as an object sometimes and a
    // string other times, and both reach these readers.
    check("a stored JSON string is read", readShowcaseTrip(JSON.stringify(goodTrip))?.jobId === "job-abc");
    check("  and an already-deserialized object", readShowcaseTrip(goodTrip)?.jobId === "job-abc");
    check("destinations come through in order", readShowcaseTrip(goodTrip)?.destinations.join(",") === "Rome,Florence");
    check("addedAt comes through", readShowcaseTrip(goodTrip)?.addedAt === 1_700_000_000_000);

    check("a demo trip is read", readDemoTrip(JSON.stringify(goodDemo))?.jobId === "job-abc");
    check("  as an object too", readDemoTrip(goodDemo)?.destinations.join(",") === "Rome");
    check("setAt comes through", readDemoTrip(goodDemo)?.setAt === 1_700_000_000_000);

    const list = labels([JSON.stringify(goodTrip), goodTrip, JSON.stringify(goodDemo)]);
    check("a whole good list reads", list.length === 3, JSON.stringify(list));
    check("  and the labels are the page's own", list[0] === "Rome · Florence", list[0]);
  }

  {
    section("one bad entry costs itself and nothing else");

    // THE property. Each of these used to take every card with it.
    const bad: [string, unknown][] = [
      ["a truncated entry", '{"jobId":"b","destinations":['],
      ["a non-JSON entry", "not json"],
      ["an empty string", ""],
      ["destinations as a string", JSON.stringify({ jobId: "b", destinations: "Rome", addedAt: 1 })],
      ["destinations missing", JSON.stringify({ jobId: "b", addedAt: 1 })],
      ["destinations as an object", JSON.stringify({ jobId: "b", destinations: { a: "Rome" }, addedAt: 1 })],
      ["destinations empty", JSON.stringify({ jobId: "b", destinations: [], addedAt: 1 })],
      ["destinations of non-strings", JSON.stringify({ jobId: "b", destinations: [42, null], addedAt: 1 })],
      ["a null entry", JSON.stringify(null)],
      ["a number entry", 42],
      ["a bare array", JSON.stringify(["Rome"])],
      ["no jobId", JSON.stringify({ destinations: ["Rome"], addedAt: 1 })],
      ["a blank jobId", JSON.stringify({ jobId: "   ", destinations: ["Rome"], addedAt: 1 })],
      ["a numeric jobId", JSON.stringify({ jobId: 42, destinations: ["Rome"], addedAt: 1 })],
    ];

    for (const [name, entry] of bad) {
      let threw = false;
      let out: string[] = [];
      try {
        out = labels([JSON.stringify(goodTrip), entry, JSON.stringify(goodTrip)]);
      } catch {
        threw = true;
      }
      check(`${name} does not take the gallery down`, threw === false);
      check("  and the two good cards survive", out.length === 2, `${out.length}: ${JSON.stringify(out)}`);
    }

    // And the whole list being garbage is an empty gallery, not a 500.
    let threw = false;
    let empty: string[] = [];
    try {
      empty = labels(["not json", null, 42, JSON.stringify({ nope: true })]);
    } catch {
      threw = true;
    }
    check("an entirely unreadable list does not throw", threw === false);
    check("  it is simply empty", empty.length === 0, JSON.stringify(empty));
    check("so is no list at all", labels([]).length === 0);
  }

  {
    section("a partly-readable entry keeps what is readable");

    // addedAt is only used for ordering and the list's own order is what
    // the page reverses, so an unreadable one must not cost the card.
    for (const setAt of [undefined, null, "yesterday", Number.NaN, {}]) {
      const t = readShowcaseTrip(JSON.stringify({ jobId: "b", destinations: ["Rome"], addedAt: setAt }));
      check(`addedAt as ${JSON.stringify(setAt) ?? "undefined"} keeps the card`, t !== null, JSON.stringify(t));
      check("  with a usable number", typeof t?.addedAt === "number" && Number.isFinite(t.addedAt), String(t?.addedAt));
    }

    // A non-string destination among real ones is dropped, not fatal.
    const mixed = readShowcaseTrip(JSON.stringify({ jobId: "b", destinations: ["Rome", 42, null, "  ", "Florence"], addedAt: 1 }));
    check("only the real destinations survive", mixed?.destinations.join(",") === "Rome,Florence", JSON.stringify(mixed?.destinations));
  }

  {
    section("the demo trip, same shapes");

    // Same reader shape, because these two are the same feature in the
    // singular and the plural - so the same list of bad values applies.
    for (const [name, value] of [
      ["a truncated value", '{"jobId":"b","destinations":['],
      ["non-JSON", "not json"],
      ["null", null],
      ["undefined", undefined],
      ["a number", 42],
      ["no destinations", JSON.stringify({ jobId: "b", setAt: 1 })],
      ["destinations as a string", JSON.stringify({ jobId: "b", destinations: "Rome", setAt: 1 })],
      ["destinations empty", JSON.stringify({ jobId: "b", destinations: [], setAt: 1 })],
      ["no jobId", JSON.stringify({ destinations: ["Rome"], setAt: 1 })],
    ] as [string, unknown][]) {
      let threw = false;
      let out: unknown = "not-called";
      try {
        out = readDemoTrip(value);
      } catch {
        threw = true;
      }
      check(`${name} does not throw`, threw === false);
      // null is what the route already handles: `{ demo: null }`, and the
      // homepage shows no link. That is the documented behaviour for "no
      // demo set", which is exactly what an unreadable one is.
      check("  and reads as no demo", out === null, String(out));
    }
  }

  {
    section("the feedback list, which has no TTL");

    // Same two lines, third list. /admin/feedback did the parse inside a
    // map and then rendered `e.rating.toUpperCase()` and `e.item.title` -
    // two unguarded dereferences on fields nothing checked. And this list
    // is stored durably on purpose ("the whole point is accumulating a
    // correction dataset over time"), so a bad entry is permanent and the
    // page that would show it to you is the page it breaks.
    const good = {
      id: "f1",
      jobId: "job-abc",
      createdAt: 1_700_000_000_000,
      day: 2,
      rating: "wrong",
      comment: "closed when we got there",
      item: { time: "13:00", type: "meal", title: "Lunch at Roscioli", location: "Rome", cost_estimate_eur: 28, reasoning: "r", source_confidence: "inferred" },
    };

    check("a real entry reads", readFeedbackEntry(JSON.stringify(good))?.id === "f1");
    check("  as an object too", readFeedbackEntry(good)?.rating === "wrong");
    check("  and keeps the comment", readFeedbackEntry(good)?.comment === "closed when we got there");
    check("  and the item", readFeedbackEntry(good)?.item.title === "Lunch at Roscioli");

    const bad: [string, unknown][] = [
      ["a truncated entry", '{"id":"f2","rating":'],
      ["a non-JSON entry", "not json"],
      ["null", JSON.stringify(null)],
      ["a number", 42],
      ["no rating", JSON.stringify({ id: "f2", item: good.item })],
      ["a rating that is not one", JSON.stringify({ id: "f2", rating: "meh", item: good.item })],
      ["a numeric rating", JSON.stringify({ id: "f2", rating: 1, item: good.item })],
    ];
    for (const [name, entry] of bad) {
      let threw = false;
      let out: FeedbackEntry[] = [];
      try {
        out = readFeedbackList([JSON.stringify(good), entry, JSON.stringify(good)]);
      } catch {
        threw = true;
      }
      check(`${name} does not take the page down`, threw === false);
      check("  and the two real entries survive", out.length === 2, String(out.length));
    }

    // The two dereferences the page makes, on every shape that used to
    // reach them.
    for (const item of [undefined, null, "Lunch", 42, {}, { title: 42 }, []] as unknown[]) {
      const e = readFeedbackEntry({ ...good, item });
      check(`item as ${JSON.stringify(item) ?? "undefined"} keeps the feedback`, e !== null, JSON.stringify(e));
      // Losing a whole piece of feedback because the snapshot beside it is
      // malformed would lose the data this list exists to keep.
      let threw = false;
      try {
        // Exactly what the page does.
        void `${e?.rating.toUpperCase()} ${e?.item.title} ${e?.item.type} ${e?.item.location}`;
      } catch {
        threw = true;
      }
      check("  and the page can render it", threw === false);
    }

    const allBad = readFeedbackList(["not json", null, 42, JSON.stringify({ nope: true })]);
    check("an entirely unreadable list is empty, not a 500", allBad.length === 0, JSON.stringify(allBad));
  }

  finish();
}

main();
