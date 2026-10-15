// Run: npm run test:trip-votes

import assert from "node:assert/strict";
import { isVoterId, parseVote, summariseVotes, voteRef } from "./tripVotes";

const me = "11111111-1111-4111-8111-111111111111";
const you = "22222222-2222-4222-8222-222222222222";

assert.equal(voteRef(2, 0), "d2.1");
assert.ok(isVoterId(me));
assert.equal(isVoterId("../../x"), false);
assert.equal(isVoterId(undefined), false);

assert.ok(parseVote({ jobId: "j", ref: "d1.2", vote: 1 }).ok);
assert.ok(parseVote({ jobId: "j", ref: "d1.2", vote: 0 }).ok, "0 takes a vote back");
assert.equal(parseVote({ jobId: "j", ref: "d1.2", vote: 2 }).ok, false);
assert.equal(parseVote({ jobId: "j", ref: "x|y", vote: 1 }).ok, false, "a ref cannot smuggle a field separator");
assert.equal(parseVote({ ref: "d1.2", vote: 1 }).ok, false);
assert.equal(parseVote(null).ok, false);

const summary = summariseVotes(
  {
    [`d1.1|${me}`]: "1",
    [`d1.1|${you}`]: "-1",
    [`d1.2|${you}`]: 1, // Upstash may hand numbers back as numbers
    [`d1.3|${me}`]: "7", // not a vote
    junk: "1",
  },
  me
);
assert.deepEqual(summary.counts, { "d1.1": { up: 1, down: 1 }, "d1.2": { up: 1, down: 0 } });
assert.deepEqual(summary.mine, { "d1.1": 1 });
assert.equal(summary.voters, 2);
assert.deepEqual(summariseVotes(null, null), { counts: {}, mine: {}, voters: 0 });

console.log("tripVotes: all assertions passed");
