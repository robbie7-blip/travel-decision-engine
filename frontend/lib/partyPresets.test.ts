// Run: npm run test:party-presets

import assert from "node:assert/strict";
import {
  applyPreset,
  partySizeOf,
  presetOf,
  stepParty,
  translatePartyComposition,
  travelerCount,
} from "./partyPresets";

const party = (size: string, composition: string) => ({ party_size: size, party_composition: composition });

// Presets are recognised in either language, and case or stray spaces do
// not turn one into a custom description.
assert.equal(presetOf("couple"), "couple");
assert.equal(presetOf("  Couple "), "couple");
assert.equal(presetOf("двойка"), "couple");
assert.equal(presetOf("група приятели"), "friends");
assert.equal(presetOf("couple, late 20s"), null);
assert.equal(presetOf(""), null);

// Sizes: empty, junk and zero are all "no number yet"; huge is capped at
// what validation.ts accepts.
assert.equal(partySizeOf(party("", "")), 0);
assert.equal(partySizeOf(party("abc", "")), 0);
assert.equal(partySizeOf(party("0", "")), 0);
assert.equal(partySizeOf(party("4", "")), 4);
assert.equal(partySizeOf(party("999", "")), 50);

// Tapping a preset writes both fields.
assert.deepEqual(applyPreset(party("5", "group of friends"), "solo", "en"), party("1", "solo traveler"));
assert.deepEqual(applyPreset(party("1", "solo traveler"), "couple", "en"), party("2", "couple"));
assert.deepEqual(applyPreset(party("2", "couple"), "family", "en"), party("3", "family with children"));
assert.deepEqual(applyPreset(party("5", "couple"), "family", "en"), party("5", "family with children"));
assert.deepEqual(applyPreset(party("2", "couple"), "friends", "bg"), party("3", "група приятели"));

// Stepping keeps the preset honest about the number.
assert.deepEqual(stepParty(party("2", "couple"), -1, "en"), party("1", "solo traveler"));
assert.deepEqual(stepParty(party("1", "solo traveler"), 1, "en"), party("2", "couple"));
assert.deepEqual(stepParty(party("2", "couple"), 1, "en"), party("3", "group of friends"));
assert.deepEqual(stepParty(party("3", "family with children"), -1, "en"), party("2", "family with children"));
assert.deepEqual(stepParty(party("1", "solo traveler"), -1, "en"), party("1", "solo traveler"));
assert.deepEqual(stepParty(party("50", "group of friends"), 1, "en"), party("50", "group of friends"));

// A description the traveller wrote is never rewritten, even when the
// number moves - including down to one.
assert.deepEqual(stepParty(party("2", "me and my sister"), 1, "en"), party("3", "me and my sister"));
assert.deepEqual(stepParty(party("2", "me and my sister"), -1, "en"), party("1", "me and my sister"));

// An empty description gets a preset rather than staying empty, which the
// server would reject.
assert.deepEqual(stepParty(party("", ""), 1, "en"), party("2", "couple"));

// Stepping in Bulgarian writes Bulgarian.
assert.deepEqual(stepParty(party("2", "couple"), -1, "bg"), party("1", "сам пътешественик"));

// Language switch: presets follow, custom text does not.
assert.equal(translatePartyComposition("couple", "bg"), "двойка");
assert.equal(translatePartyComposition("семейство с деца", "en"), "family with children");
assert.equal(translatePartyComposition("couple, late 20s", "bg"), "couple, late 20s");

assert.equal(travelerCount(party("1", ""), "en"), "1 traveler");
assert.equal(travelerCount(party("4", ""), "en"), "4 travelers");
assert.equal(travelerCount(party("4", ""), "bg"), "4 пътуващи");
assert.equal(travelerCount(party("", ""), "en"), "");

console.log("partyPresets: all assertions passed");
