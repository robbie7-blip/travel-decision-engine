// The tester link: a pass works only for the current code, and a new code
// or turning the link off ends every pass made before.
//
// Run: npm run test:tester-pass

import { currentTesterCode, hasTesterPass, isCurrentCode, newTesterCode, passFor, turnOffTesterLink } from "./testerPass";
import { check, finish, heading, section } from "./testutil";

process.env.SESSION_SECRET = "a-test-secret-that-is-long-enough-to-sign-with";

function memoryRedis() {
  const kv = new Map<string, unknown>();
  return {
    async get(k: string) {
      return kv.has(k) ? kv.get(k) : null;
    },
    async set(k: string, v: unknown) {
      kv.set(k, v);
      return "OK";
    },
    async del(k: string) {
      kv.delete(k);
      return 1;
    },
  } as unknown as Parameters<typeof hasTesterPass>[0];
}

async function main() {
  heading("the tester link");

  section("no link yet");
  {
    const redis = memoryRedis();
    check("there is no code", (await currentTesterCode(redis)) === null);
    check("no code, no pass", !(await hasTesterPass(redis, "anything")));
    check("no cookie, no pass", !(await hasTesterPass(redis, undefined)));
  }

  section("a link and its pass");
  {
    const redis = memoryRedis();
    const code = await newTesterCode(redis);
    check("the code is long and random", code.length >= 16 && code !== (await newTesterCode(memoryRedis())));
    check("the link's code is recognised", await isCurrentCode(redis, code));
    check("a made-up code is not", !(await isCurrentCode(redis, "guess")));
    const pass = passFor(code)!;
    check("the pass from it works", await hasTesterPass(redis, pass));
    check("a forged pass does not", !(await hasTesterPass(redis, pass.slice(0, -1) + (pass.endsWith("A") ? "B" : "A"))));
    check("the code itself is not a pass", !(await hasTesterPass(redis, code)));

    const next = await newTesterCode(redis);
    check("a new link ends the old passes", !(await hasTesterPass(redis, pass)));
    check("and the old link", !(await isCurrentCode(redis, code)));
    check("while the new one works", await hasTesterPass(redis, passFor(next)!));

    await turnOffTesterLink(redis);
    check("turned off, no pass works", !(await hasTesterPass(redis, passFor(next)!)));
  }

  section("without a usable secret");
  {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short";
    check("no pass can be made", passFor("x") === null);
    process.env.SESSION_SECRET = saved;
  }

  finish();
}

void main();
