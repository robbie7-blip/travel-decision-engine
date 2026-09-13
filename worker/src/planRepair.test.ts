// The day plan: the single most expensive call in the pipeline, and the
// only one every other call waits for.
//
// Measured on a real generation: the plan took 68.8s of a 102.4s total -
// 67% of it - while the trip frame, its concurrent sibling, cost the
// traveler nothing at all because the day calls run alongside it. Anything
// that makes the plan happen twice therefore doubles the visible length of
// the whole product.
//
// Two things could do that, and both are covered here:
//
//   - isUsablePlan is a wall. One day missing one field and the ENTIRE plan
//     is discarded and regenerated from scratch. For `city` on a multi-city
//     trip that is correct - there is no honest way to guess it. For a field
//     that is arithmetic on the brief it is a full regeneration for nothing.
//     And one case was a flat contradiction: the plan prompt says in as many
//     words that a generic activity "needs no anchor", so a day with no
//     anchors key is the model obeying instructions, and the validator threw
//     away the whole trip plan for it.
//
//   - a truncated phase-1 half used to be re-sent with the IDENTICAL token
//     cap. Guaranteed to truncate again, after which the two-phase path was
//     abandoned and the whole itinerary regenerated in one serial call:
//     three paid calls and the two-minute path, for a failure whose fix was
//     already written in the error message.
//
// generatePhase1Half is driven against a stub client here, so the escalation,
// the repair hook and the refusal path are all exercised with no key and no
// network.
//
// Run: npm run test:plan-repair

process.env.WORKER_NO_AUTOSTART = "1";

import type Anthropic from "@anthropic-ai/sdk";
import { isUsablePlan, normalizePlan, planCoversTrip } from "./engine/twoPhase";
import { generatePhase1Half } from "./index";
import { check, finish, heading, section } from "./testutil";
import type { SkeletonDay, TripPlan } from "./engine/twoPhase";
import type { TripBriefInput } from "./types";

heading("day plan repair and phase-1 cap escalation");

const brief = (over: Partial<TripBriefInput> = {}): TripBriefInput => ({
  destinations: ["Rome"],
  origin: "Sofia",
  start_date: "2027-05-01",
  end_date: "2027-05-04",
  party_size: 2,
  party_composition: "couple",
  budget_total_eur: 3000,
  pace: "moderate",
  interests: [],
  must_see: [],
  dietary_constraints: [],
  mobility_constraints: [],
  hard_no: [],
  language: "en",
  needs_lodging: true,
  needs_flight: true,
  ...over,
});

/** A plan day as it arrives: a loose record, because the entire point of
 * these cases is that the shape is NOT a SkeletonDay until the repair has
 * run. Typing them as SkeletonDay would require casts that assert away the
 * very defect under test. */
type Loose = Record<string, unknown>;

const day = (over: Loose = {}): Loose => ({
  day: 1,
  date: "2027-05-01",
  city: "Rome",
  theme: "arrival and Trastevere",
  include_lodging: true,
  anchors: ["Roscioli (dinner)"],
  meals: ["lunch", "dinner"],
  ...over,
});

const plan = (...days: Loose[]) => ({ days });

/** One field, off one day, after the repair ran. */
const got = (p: { days: Loose[] }, index: number, key: string): unknown => p.days[index]?.[key];

/** One field across every day, joined, for a single readable assertion. */
const across = (p: { days: Loose[] }, key: string): string => p.days.map((d) => String(d[key])).join(",");

/** Runs a raw plan through the repair and reports whether the validator
 * would then accept it - which is the only question that matters, since
 * rejection is what costs a full regeneration. */
function accepted(raw: unknown, b: TripBriefInput = brief()): boolean {
  return isUsablePlan(normalizePlan(raw, b));
}

/** A stub Anthropic client: returns the queued responses in order and
 * records what each request asked for.
 *
 * Only `stream` is implemented. `create` throws, and that is the point: a
 * phase-1 half MUST stream. `messages.create` on a non-streaming request
 * refuses outright when max_tokens implies a response that could take over
 * ten minutes - ~21,300 tokens for this model, against SKELETON_MAX_TOKENS
 * of 24,000 - and the only reason that was not failing every request is
 * that the SDK skips the guard when the client carries an explicit timeout,
 * which this worker sets. Verified against the real SDK over a local
 * server: without the explicit timeout, a 24,000-token non-streaming
 * request throws "Streaming is required for operations that may take longer
 * than 10 minutes". A stub that answered both ways would let a silent
 * revert to `create` pass. */
function stubClient(responses: { text?: string; stop_reason?: string }[]) {
  const caps: number[] = [];
  const efforts: (string | undefined)[] = [];
  let i = 0;
  const message = (r: { text?: string; stop_reason?: string }) => ({
    content: [{ type: "text", text: r.text ?? "" }],
    stop_reason: r.stop_reason ?? "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  const client = {
    messages: {
      create: async () => {
        throw new Error(
          "a phase-1 half must stream - messages.create refuses a non-streaming request at this token cap"
        );
      },
      stream: (body: { max_tokens: number; output_config?: { effort?: string } }) => {
        caps.push(body.max_tokens);
        efforts.push(body.output_config?.effort);
        const r = responses[Math.min(i++, responses.length - 1)];
        // `on` too: streamMessage subscribes to streamEvent and text to
        // measure where a call's time went. A stub without it is a client
        // that does not exist, and this suite said so the moment the real
        // code started listening - "stream.on is not a function".
        const stream = {
          finalMessage: async () => message(r),
          abort: () => {},
          on: () => stream,
          off: () => stream,
          once: () => stream,
        };
        return stream;
      },
    },
  } as unknown as Anthropic;
  return { client, caps, efforts, calls: () => i };
}

const goodPlan = JSON.stringify({
  days: [{ day: 1, date: "2027-05-01", city: "Rome", theme: "t", include_lodging: false, anchors: [] }],
});

/** The response that used to cost a full regeneration: a day with no
 * anchors key, which the plan prompt explicitly permits. */
const noAnchorsPlan = JSON.stringify({
  days: [{ day: 1, date: "2027-05-01", city: "Rome", theme: "t", include_lodging: false }],
});

async function main() {
  section("what the repair must NOT change");

  {
    const raw = plan(day(), day({ day: 2, date: "2027-05-02", anchors: [] }));
    const before = JSON.stringify(raw);
    const after = normalizePlan(raw, brief());
    check("a complete plan is returned untouched", JSON.stringify(after) === before, JSON.stringify(after));
    check("and is accepted", isUsablePlan(after));
  }

  {
    // A date the model wrote is never moved. A plan that genuinely
    // disagrees about dates is a plan worth regenerating, not one worth
    // silently rewriting into agreement.
    const raw = plan(day({ date: "2027-06-15" }));
    normalizePlan(raw, brief());
    check("a date the model chose is left alone even if it's wrong", got(raw, 0, "date") === "2027-06-15", String(got(raw, 0, "date")));
  }

  {
    const raw = plan(day({ anchors: ["Roscioli (dinner)"], meals: ["dinner"], theme: "t" }));
    normalizePlan(raw, brief());
    check("anchors content is never invented", JSON.stringify(got(raw, 0, "anchors")) === '["Roscioli (dinner)"]');
    check("meals content is never invented", JSON.stringify(got(raw, 0, "meals")) === '["dinner"]');
    check("theme is never invented", got(raw, 0, "theme") === "t");
  }

  {
    // include_lodging the model set to false on a middle day stays false -
    // an overnight train is a real thing, and the plan is the only stage
    // that knows about it.
    const raw = plan(day(), day({ day: 2, date: "2027-05-02", include_lodging: false }), day({ day: 3, date: "2027-05-03" }));
    normalizePlan(raw, brief());
    check("a deliberate false include_lodging survives", got(raw, 1, "include_lodging") === false);
  }

  section("the contradiction: a day the prompt says needs no anchor");

  {
    // The prompt: "Genuinely generic activities with no business to name (a
    // walk through a neighborhood, a rest at the accommodation) need no
    // anchor." The validator then required the key.
    const raw = plan(day(), day({ day: 2, date: "2027-05-02", anchors: undefined }));
    check("a day with no anchors key used to sink the whole plan", isUsablePlan(raw) === false);
    check("and is now repaired rather than regenerated", accepted(raw), JSON.stringify(raw));
    check("to an actual empty array", JSON.stringify(got(raw, 1, "anchors")) === "[]", JSON.stringify(got(raw, 1, "anchors")));
  }

  {
    const raw = plan(day({ anchors: "Roscioli" }));
    check("anchors sent as a bare string is repaired too", accepted(raw), JSON.stringify(raw));
  }

  section("fields the brief already fixes");

  {
    const raw = plan(day({ date: undefined }), day({ day: 2, date: "2027-05-02" }));
    check("a missing date used to sink the plan", isUsablePlan(raw) === false);
    check("and is now derived from the start date", accepted(raw));
    check("day 1 is the start date", got(raw, 0, "date") === "2027-05-01", String(got(raw, 0, "date")));
  }

  {
    // Position in the array is the authority, and index.ts overwrites both
    // day and date from the skeleton before anything is merged, so this only
    // has to be right enough to get past the validator.
    const raw = plan(day(), day({ day: 2, date: "not a date" }), day({ day: 3, date: undefined }));
    check("a malformed date is replaced", accepted(raw));
    check("by the right calendar day", got(raw, 1, "date") === "2027-05-02", String(got(raw, 1, "date")));
    check("and so is a missing one further along", got(raw, 2, "date") === "2027-05-03", String(got(raw, 2, "date")));
  }

  {
    // Month-end arithmetic, done with real dates rather than by adding to
    // the day-of-month. An earlier test in this repo produced "2026-04-39".
    const raw = plan(day({ date: undefined }), day({ day: 2, date: undefined }), day({ day: 3, date: undefined }));
    normalizePlan(raw, brief({ start_date: "2027-04-29", end_date: "2027-05-01" }));
    check("a derived date rolls into the next month correctly", across(raw, "date") === "2027-04-29,2027-04-30,2027-05-01", across(raw, "date"));
  }

  {
    const raw = plan(day({ date: undefined }), day({ day: 2, date: undefined }));
    normalizePlan(raw, brief({ start_date: "2028-02-28", end_date: "2028-02-29" }));
    check("and across a leap day", across(raw, "date") === "2028-02-28,2028-02-29", across(raw, "date"));
  }

  {
    // No start date to work from: repair what it can and leave the rest for
    // the validator, rather than writing "NaN-NaN-NaN" into the plan.
    const raw = plan(day({ date: undefined }));
    normalizePlan(raw, brief({ start_date: "" }));
    check("an unusable start date leaves the field alone", got(raw, 0, "date") === undefined, String(got(raw, 0, "date")));
    check("so the validator still rejects it", isUsablePlan(raw) === false);
  }

  {
    const raw = plan(day({ day: "1" }), day({ day: 2, date: "2027-05-02" }));
    check("a day number sent as a string used to sink the plan", isUsablePlan(raw) === false);
    check("and is now coerced", accepted(raw));
    check("to the number it said", got(raw, 0, "day") === 1, String(got(raw, 0, "day")));
  }

  {
    const raw = plan(day({ day: undefined }), day({ day: undefined, date: "2027-05-02" }));
    check("a missing day number falls back to position", accepted(raw));
    check("numbered from 1", across(raw, "day") === "1,2", across(raw, "day"));
  }

  section("include_lodging, which is the prompt's own rule");

  {
    // "true for every day the traveler actually spends the night, false for
    // the final departure day" - written in the prompt, so derivable.
    const raw = plan(
      day({ include_lodging: undefined }),
      day({ day: 2, date: "2027-05-02", include_lodging: undefined }),
      day({ day: 3, date: "2027-05-03", include_lodging: undefined })
    );
    check("a plan with no include_lodging anywhere used to be rejected", isUsablePlan(raw) === false);
    check("and is now filled in", accepted(raw));
    check("every night but the departure day", across(raw, "include_lodging") === "true,true,false", across(raw, "include_lodging"));
  }

  {
    // needs_lodging false means the traveler has their own bed. Filling
    // these in as true would put a hotel, and a hotel's price, into a trip
    // that explicitly excluded both.
    const raw = plan(day({ include_lodging: undefined }), day({ day: 2, date: "2027-05-02", include_lodging: undefined }));
    normalizePlan(raw, brief({ needs_lodging: false }));
    check("with accommodation already arranged, no day claims a night", across(raw, "include_lodging") === "false,false", across(raw, "include_lodging"));
  }

  {
    const raw = plan(day({ include_lodging: undefined }));
    normalizePlan(raw, brief({ start_date: "2027-05-01", end_date: "2027-05-01" }));
    check("a one-day trip's only day is a departure day", got(raw, 0, "include_lodging") === false, String(got(raw, 0, "include_lodging")));
  }

  section("city: repaired only when there is nothing to guess");

  {
    const raw = plan(day({ city: undefined }));
    check("on a single-destination trip the city is unambiguous", accepted(raw));
    check("and is the only destination", got(raw, 0, "city") === "Rome", String(got(raw, 0, "city")));
  }

  {
    // The one field worth a full regeneration. It decides which city's
    // accommodation, prices and venues a day is written against; guessing it
    // would ship a day in the wrong city rather than cost a retry.
    const raw = plan(day({ city: undefined }), day({ day: 2, date: "2027-05-02", city: "Florence" }));
    const b = brief({ destinations: ["Rome", "Florence"] });
    normalizePlan(raw, b);
    check("on a multi-city trip a missing city is NOT guessed", got(raw, 0, "city") === undefined, String(got(raw, 0, "city")));
    check("so the plan is still rejected and regenerated", accepted(raw, b) === false);
  }

  section("shapes that must not throw");

  for (const input of [null, undefined, 42, "plan", {}, { days: [] }, { days: "x" }, { days: [null] }, { days: [42] }]) {
    let threw = false;
    try {
      normalizePlan(input, brief());
    } catch {
      threw = true;
    }
    check(`${JSON.stringify(input) ?? "undefined"} does not throw`, threw === false);
  }

  {
    // A repair pass that made a malformed plan LOOK valid would be worse
    // than no repair at all: it would feed garbage into the day calls.
    check("an empty days array is still rejected", accepted({ days: [] }) === false);
    check("a null day is still rejected", accepted({ days: [null] }) === false);
    check("a non-object plan is still rejected", accepted("nope") === false);
  }

  section("the plan must cover the days the traveler asked for");

  {
    // Nothing checked this. isUsablePlan validates the SHAPE of each day and
    // says nothing about how many there are - and from there the plan is the
    // authority on the trip's length: one paid call per planned day, the
    // night count from include_lodging across the planned days, the budget
    // derived from that. So a short plan shipped a paid trip with a day
    // missing, priced and checked and reported as complete, with every
    // downstream count agreeing with it.
    const b = brief({ start_date: "2027-05-01", end_date: "2027-05-03" }); // three days
    const three = { days: [day(), day({ day: 2 }), day({ day: 3 })] } as unknown as TripPlan;
    const two = { days: [day(), day({ day: 2 })] } as unknown as TripPlan;
    const four = { days: [day(), day({ day: 2 }), day({ day: 3 }), day({ day: 4 })] } as unknown as TripPlan;
    check("the right number of days is accepted", planCoversTrip(three, b) === true);
    check("a day missing is rejected", planCoversTrip(two, b) === false);
    check("a day too many is rejected", planCoversTrip(four, b) === false);
  }

  {
    // Both bounds are inclusive, so a same-day trip is one day, not zero.
    const oneDay = brief({ start_date: "2027-05-01", end_date: "2027-05-01" });
    check("a single-day trip wants exactly one day", planCoversTrip({ days: [day()] } as unknown as TripPlan, oneDay) === true);
    check("and not two", planCoversTrip({ days: [day(), day({ day: 2 })] } as unknown as TripPlan, oneDay) === false);
  }

  {
    // "Can't tell" must not fail a plan that may well be right. A brief
    // whose dates don't parse is already refused by validation.ts, long
    // before a model call.
    const bad = brief({ start_date: "not a date", end_date: "also not" });
    check("an unreadable brief does not reject the plan", planCoversTrip({ days: [day()] } as unknown as TripPlan, bad) === true);
    const reversed = brief({ start_date: "2027-05-10", end_date: "2027-05-01" });
    check("dates in the wrong order do not reject it either", planCoversTrip({ days: [day()] } as unknown as TripPlan, reversed) === true);
  }

  {
    // A month boundary, since the span is real date arithmetic.
    const acrossMonths = brief({ start_date: "2027-04-29", end_date: "2027-05-02" }); // four days
    const four = { days: [day(), day({ day: 2 }), day({ day: 3 }), day({ day: 4 })] } as unknown as TripPlan;
    check("a span across a month boundary counts correctly", planCoversTrip(four, acrossMonths) === true);
  }

  section("a truncated half retries at a BIGGER cap, not the same one");

  {
    // The defect: identical re-send, guaranteed second truncation, then the
    // whole two-phase path abandoned for one serial call.
    const stub = stubClient([{ stop_reason: "max_tokens" }, { text: goodPlan }]);
    // Caught rather than awaited bare: without the escalation this throws,
    // and a regression should read as a named failure here, not as an
    // unhandled stack that buries the rest of the suite.
    let result: TripPlan | null = null;
    let failed = "";
    try {
      result = await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, {});
    } catch (e) {
      failed = (e as Error).message;
    }
    check("the truncated call is retried", stub.calls() === 2, `${stub.calls()} call(s), ${failed}`);
    check("at a strictly larger cap", stub.caps[1] > stub.caps[0], stub.caps.join(","));
    check("and the plan comes back usable", result?.days.length === 1, failed || JSON.stringify(result));
  }

  {
    // Escalation is not infinite. Two truncations is a cap problem worth
    // surfacing, not worth a third paid call.
    const stub = stubClient([{ stop_reason: "max_tokens" }, { stop_reason: "max_tokens" }]);
    let message = "";
    try {
      await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, {});
    } catch (e) {
      message = (e as Error).message;
    }
    check("it escalates at most once", stub.calls() === 2, String(stub.calls()));
    check("then reports the cap as the problem", message.includes("cut off mid-JSON"), message);
  }

  {
    const stub = stubClient([{ text: goodPlan }]);
    await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, {});
    check("a healthy call makes exactly one request", stub.calls() === 1, String(stub.calls()));
  }

  section("the repair hook runs before the validator, on the real call path");

  {
    // End to end: the model returns a day with no anchors key - which its
    // own instructions permit - and the call succeeds instead of throwing
    // into a full regeneration.
    const stub = stubClient([{ text: noAnchorsPlan }]);
    let failed = "";
    let result: TripPlan | null = null;
    try {
      result = await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, {
        normalize: (v) => normalizePlan(v, brief()),
      });
    } catch (e) {
      failed = (e as Error).message;
    }
    check("no retry, no throw", failed === "" && stub.calls() === 1, `${failed} / ${stub.calls()}`);
    check("and the day arrives with an empty anchor list", JSON.stringify(result?.days[0].anchors) === "[]", JSON.stringify(result?.days[0]));
  }

  {
    // Without the hook the same response costs a full regeneration - which
    // is what the 68.8s plan call looked like from outside.
    const stub = stubClient([{ text: noAnchorsPlan }]);
    let failed = "";
    try {
      await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, {});
    } catch (e) {
      failed = (e as Error).message;
    }
    check("with no repair hook the same response is rejected", failed.includes("missing required fields"), failed);
  }

  section("phase 1 streams, and cannot quietly stop streaming");

  {
    // The stub's `create` throws. If generatePhase1Half ever goes back to
    // messages.create, every case in the two sections above turns red - and
    // that is the right blast radius, because non-streaming at this cap is
    // what made CALL_TIMEOUT_MS a 120-second cap on total generation time
    // against a plan call measured at 68.8 seconds.
    const stub = stubClient([{ text: goodPlan }]);
    let failed = "";
    try {
      await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, {});
    } catch (e) {
      failed = (e as Error).message;
    }
    check("the call went through stream, not create", failed === "", failed);
    check("and asked for the phase-1 cap", stub.caps[0] === 24000, String(stub.caps[0]));
  }

  {
    // usage and stop_reason have to survive the stream, since every branch
    // downstream reads them off the assembled message. Confirmed against
    // the real SDK over a local SSE server too: stop_reason, usage and text
    // all arrive intact through finalMessage().
    const stub = stubClient([{ stop_reason: "refusal" }]);
    let message = "";
    try {
      await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, {});
    } catch (e) {
      message = (e as Error).message;
    }
    check("stop_reason survives the stream", message.includes("declined"), message);
  }

  section("the effort dial reaches the request");

  {
    const stub = stubClient([{ text: goodPlan }]);
    await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, { effort: "medium" });
    check("the configured effort is what is sent", stub.efforts[0] === "medium", String(stub.efforts[0]));
  }

  section("a refusal is not a cap problem");

  {
    const stub = stubClient([{ stop_reason: "refusal" }]);
    let message = "";
    try {
      await generatePhase1Half<TripPlan>(stub.client, "day plan", "sys", "user", isUsablePlan, undefined, {});
    } catch (e) {
      message = (e as Error).message;
    }
    check("a refusal is not escalated", stub.calls() === 1, String(stub.calls()));
    check("and says the model declined", message.includes("declined"), message);
  }

  // Referenced so the SkeletonDay contract stays imported and checked: the
  // loose records above must still satisfy it once repaired.
  const repaired = normalizePlan(plan(day()), brief()) as TripPlan;
  const first: SkeletonDay = repaired.days[0];
  check("a repaired day satisfies the SkeletonDay contract", typeof first.city === "string" && Array.isArray(first.anchors));

  finish();
}

void main();
