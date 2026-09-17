// The failure diagnostics: what they carry, and what they must never carry.
//
// This record is written into Redis by the worker and rendered onto
// /admin/health by the app, which is the exact pair the heartbeat was
// designed never to let a credential near ("Presence only. It reads whether
// a variable is set, never what it is."). The difference is that a
// heartbeat is a list of NAMES this product writes itself, and this is an
// arbitrary error message from somebody else's client library - and those
// do print credentials:
//
//   ioredis      "connect ECONNREFUSED" against the URL it was given, and
//                a Redis URL is redis://default:<password>@host:6379
//   fetch/undici the request it could not complete, headers included
//   any client   an Authorization header echoed back in a wrapped error
//
// So the redaction is not a nicety, it is the reason this feature is
// allowed to exist at all. Everything below is a string that must come out
// the other side without the secret in it.
//
// The rest of the suite is the ordinary reason a stored record needs tests:
// it outlives the deploy that wrote it, and it is read straight onto the
// page whose only job is to say what is broken - so an older shape has to
// render as "one entry could not be read" rather than throwing during that
// page's render.
//
// One copy of this suite, not two: everything it exercises lives in the
// jobs.ts mirrors, and check:mirrors holds the worker's copy byte-identical
// to the one imported here.
//
// Run: npm run test:worker-failure

import {
  buildWorkerFailure,
  isWorkerFailure,
  readWorkerFailure,
  redactSecrets,
  WORKER_FAILURES_KEPT,
  type WorkerFailure,
} from "./jobs";
import { check, finish, heading, section } from "./testutil";

heading("worker failure diagnostics");

/** The shapes of credential this product actually holds, written into the
 * kind of sentence a client library produces. Each pair is the secret and
 * the message it turns up in. */
const REAL_SECRETS: { what: string; secret: string; message: string }[] = [
  {
    what: "a Redis URL's password",
    secret: "hunter2correcthorsebattery",
    message:
      "connect ECONNREFUSED: could not reach " +
      "redis://default:hunter2correcthorsebattery@eu2-fine-mole-12345.upstash.io:6379",
  },
  {
    what: "an Anthropic key",
    secret: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA",
    message: "401 authentication_error for key sk-ant-api03-AAAAAAAAAAAAAAAAAAAA",
  },
  {
    what: "a Google Places key",
    secret: "AIzaSyD-ExampleExampleExampleExample",
    message: "Request failed: https://maps.googleapis.com/maps/api/place/findplacefromtext/json" +
      "?key=AIzaSyD-ExampleExampleExampleExample&input=Pizzarium",
  },
  {
    what: "an Authorization header",
    // Deliberately short of the blunt 40-character rule, so this case can
    // only pass on the bearer pattern itself.
    secret: "eyJhbGciOiJIUzI1NiJ9.abc",
    message: 'upstream rejected the request {"authorization":"Bearer eyJhbGciOiJIUzI1NiJ9.abc"}',
  },
  {
    what: "an Upstash REST token, which has no prefix to match on",
    secret: "AX8rASQgN2Y4ZmY4NDktZDFmMy00YTFlLThmMmMtOTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5",
    message:
      "fetch failed with token " +
      "AX8rASQgN2Y4ZmY4NDktZDFmMy00YTFlLThmMmMtOTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5",
  },
];

function main() {
  section("no credential survives redaction");

  for (const { what, secret, message } of REAL_SECRETS) {
    const out = redactSecrets(message);
    check(`${what} is gone`, !out.includes(secret), out);
    check(`${what} - something is still said`, out.length > 0 && out !== message, out);
  }

  {
    // The whole point of building the record through one function: a caller
    // cannot forget to redact, because there is no path that stores the raw
    // string. The stack is redacted too - a message embedded in frame zero
    // would otherwise skip the redaction the message itself gets, which is
    // the shape of every "we sanitised the obvious field" bug.
    const err = new Error("connect failed: redis://default:hunter2correcthorsebattery@host:6379");
    const built = buildWorkerFailure("job-1", err, { reached: [], days: 3 });
    check("the message is redacted by buildWorkerFailure", !built.message.includes("hunter2correcthorsebattery"), built.message);
    check(
      "and so is the stack, whose first frame repeats the message",
      !built.stack.join("\n").includes("hunter2correcthorsebattery"),
      built.stack[0] ?? "(no frames)"
    );
  }

  section("ordinary text is left readable");

  {
    // The blunt 40-character rule is the one that can over-reach, so the
    // messages this product actually produces have to survive it. A
    // redaction that eats the diagnosis is a different way of having no
    // diagnosis.
    const real = "TypeError: item.time.toLowerCase is not a function";
    check("a TypeError reads as itself", redactSecrets(real) === real, redactSecrets(real));

    const frame = "at normalizeItineraryShape (/app/worker/dist/engine/shape.js:174:21)";
    check("a stack frame keeps its file and line", redactSecrets(frame) === frame, redactSecrets(frame));

    const gate = "The trip frame was missing required fields.";
    check("a ModelOutputError reads as itself", redactSecrets(gate) === gate, redactSecrets(gate));
  }

  section("a record is built from anything that can be thrown");

  {
    const built = buildWorkerFailure("job-2", new TypeError("day.items.sort is not a function"), {
      reached: ["generation 18420ms", "verification 6100ms"],
      days: 4,
      now: 1_700_000_000_000,
    });
    check("the error name is kept", built.name === "TypeError", built.name);
    check("the message is kept", built.message === "day.items.sort is not a function", built.message);
    check("the job id is kept", built.jobId === "job-2", built.jobId);
    check("the day count is kept", built.days === 4, String(built.days));
    check("the stages reached are kept", built.reached.length === 2, JSON.stringify(built.reached));
    check("the timestamp is the one passed in", built.at === 1_700_000_000_000, String(built.at));
    check("the stack has frames", built.stack.length > 0, String(built.stack.length));
  }

  {
    // `throw "boom"`, `throw null`, `throw 42n`. Nothing here may throw:
    // this runs inside the handler for something that already went wrong,
    // and a throw in the diagnostics escapes processJob's catch entirely -
    // which leaves the job stuck at "running" until stallReason times it
    // out, four minutes later, for the traveler.
    const cases: { label: string; thrown: unknown }[] = [
      { label: "a thrown string", thrown: "boom" },
      { label: "a thrown null", thrown: null },
      { label: "a thrown undefined", thrown: undefined },
      { label: "a thrown number", thrown: 42 },
      // BigInt(42) rather than the literal: this package targets below
      // ES2020 and tsc rejects the literal form.
      { label: "a thrown BigInt, which JSON.stringify throws on", thrown: BigInt(42) },
      { label: "a thrown plain object", thrown: { code: "ECONNRESET" } },
      { label: "a thrown array", thrown: [1, 2] },
      { label: "a thrown Symbol", thrown: Symbol("nope") },
      // A getter that throws, which is what a proxied or wrapped error can
      // look like by the time it reaches a catch.
      {
        label: "an object whose message getter throws",
        thrown: new Proxy({}, { get: () => { throw new Error("nope"); } }),
      },
    ];
    for (const { label, thrown } of cases) {
      let built: WorkerFailure | null = null;
      let threw = "";
      try {
        built = buildWorkerFailure("job-3", thrown, { reached: [], days: null });
      } catch (e) {
        threw = e instanceof Error ? e.message : String(e);
      }
      check(`${label} builds a record`, built !== null, threw || "returned null");
      check(
        `${label} still names something`,
        built !== null && typeof built.name === "string" && built.name.length > 0,
        built?.name ?? "(none)"
      );
    }
  }

  {
    // Caps, so one enormous message cannot push the other 24 failures out
    // of the list or off the page.
    const long = "x".repeat(5000);
    const built = buildWorkerFailure("job-4", new Error(long), { reached: [], days: null });
    check("the message is capped", built.message.length <= 500, String(built.message.length));

    const err = new Error("deep");
    err.stack = ["Error: deep", ...Array.from({ length: 80 }, (_, i) => `    at frame${i} (/app/x.js:${i}:1)`)].join("\n");
    const deep = buildWorkerFailure("job-5", err, { reached: [], days: null });
    check("the stack is capped", deep.stack.length <= 12, String(deep.stack.length));
    check("and the list cap is small enough to read in one go", WORKER_FAILURES_KEPT <= 50, String(WORKER_FAILURES_KEPT));
  }

  {
    // An error with no stack at all - a thrown Error from a stripped build,
    // or one whose stack was reassigned.
    const err = new Error("no stack here");
    err.stack = undefined;
    const built = buildWorkerFailure("job-6", err, { reached: [], days: null });
    check("no stack is an empty array, not undefined", Array.isArray(built.stack) && built.stack.length === 0);
  }

  {
    const built = buildWorkerFailure("job-7", new Error("x"), { reached: [], days: Number.NaN });
    check("a NaN day count stores null, not NaN", built.days === null, String(built.days));
  }

  {
    // The name has to be the CLASS name, not `error.name`.
    //
    // Every custom error in this codebase is declared
    // `class ModelOutputError extends Error {}` and none of them set
    // `name`, so `error.name` is the string "Error" for all of them - and
    // this is the field the operator scans first. Measured end to end
    // through processJob: a failed day call recorded itself as plain
    // "Error" until this existed, and the useful answer was
    // "ModelOutputError".
    class ModelOutputError extends Error {}
    const named = buildWorkerFailure("job-10", new ModelOutputError("malformed"), { reached: [], days: null });
    check("a custom error class names itself", named.name === "ModelOutputError", named.name);

    const plain = buildWorkerFailure("job-11", new TypeError("x.y is not a function"), { reached: [], days: null });
    check("and a builtin still names itself", plain.name === "TypeError", plain.name);
  }

  section("reading one back");

  {
    const built = buildWorkerFailure("job-8", new TypeError("boom"), { reached: ["generation 1ms"], days: 2 });
    const roundTripped = readWorkerFailure(JSON.stringify(built));
    check("a record survives Redis as a JSON string", roundTripped !== null && roundTripped.name === "TypeError");
    check(
      "and as an already-parsed object, which is what the Upstash client hands back",
      readWorkerFailure(built) !== null
    );
  }

  {
    // Every one of these is a value that really can come out of that list:
    // an older worker's shape, a half-written push, a key someone else
    // used. None of them may throw, and none of them may pass.
    const bad: { label: string; raw: unknown }[] = [
      { label: "not JSON", raw: "{oops" },
      { label: "a JSON number", raw: "42" },
      { label: "a JSON array", raw: "[1,2]" },
      { label: "null", raw: null },
      { label: "undefined", raw: undefined },
      { label: "a record with no message", raw: JSON.stringify({ jobId: "a", at: 1, name: "E", stack: [], reached: [] }) },
      { label: "a record with a string stack", raw: JSON.stringify({ jobId: "a", at: 1, name: "E", message: "m", stack: "frames", reached: [] }) },
      { label: "a record with a NaN timestamp", raw: JSON.stringify({ jobId: "a", at: null, name: "E", message: "m", stack: [], reached: [] }) },
    ];
    for (const { label, raw } of bad) {
      let out: WorkerFailure | null | "threw" = "threw";
      try {
        out = readWorkerFailure(raw);
      } catch {
        out = "threw";
      }
      check(`${label} reads as null`, out === null, String(out));
    }
  }

  {
    // The arrays are checked as arrays and their CONTENTS are not, which is
    // the gap that renders as a throw: the page joins the stack and trims
    // each line, and a number in there is `(42).trim is not a function` on
    // the page whose job is to report failures. Same defect shape as
    // sourceUrlList's, one level down.
    const raw = JSON.stringify({
      jobId: "a",
      at: 1,
      name: "E",
      message: "m",
      stack: ["  at a (x.js:1:1)", 42, null, { frame: 1 }],
      reached: ["generation 1ms", 7],
      days: 3,
    });
    const out = readWorkerFailure(raw);
    check("a non-string stack frame is dropped", out !== null && out.stack.length === 1, JSON.stringify(out?.stack));
    check("a non-string stage is dropped", out !== null && out.reached.length === 1, JSON.stringify(out?.reached));
  }

  {
    check("isWorkerFailure rejects a bare object", !isWorkerFailure({}));
    check(
      "isWorkerFailure accepts a real one",
      isWorkerFailure(buildWorkerFailure("job-9", new Error("x"), { reached: [], days: null }))
    );
  }

  finish();
}

main();
