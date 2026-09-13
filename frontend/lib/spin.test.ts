// The wheel's city draw.
//
// Two claims to hold. "Random" is the actual promise this feature makes, so
// the shuffle has to be uniform rather than merely jumbled. And "New
// cities" has to mean new cities - it drew 12 from a pool of 24
// independently each time, so a fresh wheel shared six with the old one on
// average and could repeat most of it, which looks exactly like the button
// doing nothing.
//
// Run: npm run test:spin

import { drawWheel, INITIAL_WHEEL, spinCityName, SPIN_POOL, WHEEL_SLICES } from "./spin";
import { check, finish, heading, section } from "./testutil";

heading("spin the wheel");

/** A deterministic generator, so a claim about the draw is a claim about
 * the draw and not about today's luck. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32 - small, fast, and good enough that a bias in the result
    // is a bias in drawWheel rather than in this.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function main() {
  {
    section("the pool and the wheel");

    check("the pool is every city with a guide and a photo", SPIN_POOL.length === 24, String(SPIN_POOL.length));
    check("no duplicates in the pool", new Set(SPIN_POOL).size === SPIN_POOL.length);
    check("the wheel is twelve slices", WHEEL_SLICES === 12);
    // The property the `avoid` logic leans on: a whole second wheel exists.
    check("the pool is at least two full wheels", SPIN_POOL.length >= WHEEL_SLICES * 2);

    check("the first wheel is full", INITIAL_WHEEL.length === WHEEL_SLICES);
    check("  and deterministic, so the server and first client render agree",
      JSON.stringify(INITIAL_WHEEL) === JSON.stringify(SPIN_POOL.slice(0, WHEEL_SLICES)));
  }

  {
    section("a draw is a full wheel of real, distinct cities");

    for (const seed of [1, 2, 7, 99, 12345]) {
      const wheel = drawWheel(seeded(seed));
      check(`seed ${seed}: twelve slices`, wheel.length === WHEEL_SLICES, String(wheel.length));
      check(`  no city twice`, new Set(wheel).size === wheel.length, JSON.stringify(wheel));
      check(`  all from the pool`, wheel.every((slug) => SPIN_POOL.includes(slug)));
    }
  }

  {
    section('"New cities" means new cities');

    // THE defect. Passing the current wheel as `avoid` has to produce a
    // wheel with nothing in common - and because the pool is exactly two
    // wheels, "nothing in common" is guaranteed rather than likely.
    for (const seed of [1, 5, 42, 777]) {
      const first = drawWheel(seeded(seed));
      const second = drawWheel(seeded(seed + 1), first);
      const shared = second.filter((slug) => first.includes(slug));
      check(`seed ${seed}: not one city repeats`, shared.length === 0, JSON.stringify(shared));
      check(`  and the wheel is still full`, second.length === WHEEL_SLICES);
      // Which means the two together are the whole pool.
      check(
        `  so two presses show every city`,
        new Set([...first, ...second]).size === SPIN_POOL.length,
        String(new Set([...first, ...second]).size)
      );
    }

    // What it used to do, kept and measured, because the difference between
    // the two IS the fix. Averaged over many draws rather than asserted on
    // one, since the old behaviour's whole problem was being a coin flip.
    let overlapTotal = 0;
    const trials = 200;
    const random = seeded(2024);
    for (let i = 0; i < trials; i++) {
      const a = drawWheel(random);
      const b = drawWheel(random); // no `avoid` - the old call
      overlapTotal += b.filter((slug) => a.includes(slug)).length;
    }
    const meanOverlap = overlapTotal / trials;
    check(
      "the old call really did repeat about half the wheel",
      meanOverlap > 5 && meanOverlap < 7,
      `mean overlap ${meanOverlap.toFixed(2)} of ${WHEEL_SLICES}`
    );
  }

  {
    section("the fallback, if the pool ever stops being twice the wheel");

    // Avoiding everything leaves nothing fresh. A short wheel would leave
    // empty wedges, which is worse than a repeat, so it fills up.
    const full = drawWheel(seeded(3), SPIN_POOL);
    check("a wheel is still returned", full.length === WHEEL_SLICES, String(full.length));
    check("  with no duplicates", new Set(full).size === full.length);

    // Avoiding all but a handful: those few come first, the rest fill in.
    const scarce = SPIN_POOL.slice(0, 21);
    const mixed = drawWheel(seeded(4), scarce);
    check("still full when only three are fresh", mixed.length === WHEEL_SLICES);
    check("  no duplicates", new Set(mixed).size === mixed.length);
    check(
      "  and the fresh ones are all included",
      SPIN_POOL.slice(21).every((slug) => mixed.includes(slug)),
      JSON.stringify(mixed)
    );
  }

  {
    section("the shuffle is uniform, because that is the promise");

    // Every city must reach every slice. A biased shuffle would mean some
    // cities quietly come up more often, which is the one thing this
    // feature cannot get wrong.
    const counts = new Map<string, number>();
    const random = seeded(1789);
    const draws = 4000;
    for (let i = 0; i < draws; i++) {
      for (const slug of drawWheel(random)) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    check("every city appears", counts.size === SPIN_POOL.length, String(counts.size));
    const expected = (draws * WHEEL_SLICES) / SPIN_POOL.length;
    const worst = Math.max(...[...counts.values()].map((n) => Math.abs(n - expected) / expected));
    check("no city is favoured by more than 8%", worst < 0.08, `worst deviation ${(worst * 100).toFixed(1)}%`);
  }

  {
    section("names");

    check("a slug title-cases", spinCityName("rome", "en") === "Rome");
    check("  including the one with a separator", spinCityName("new_york", "en") === "New York");
    check("bg comes from the guides' own map", spinCityName("rome", "bg") === "Рим");
    check("  and falls back to English when there is none", spinCityName("chicago", "bg") === "Chicago");
    // Every city on the wheel must have a name in both languages, or a
    // slice renders blank.
    for (const slug of SPIN_POOL) {
      check(`${slug} is named in both languages`,
        spinCityName(slug, "en").length > 0 && spinCityName(slug, "bg").length > 0);
    }
  }

  finish();
}

main();
