// The guide cities, and how one is named.
//
// Most of this file used to be about the wheel's city draw - a uniform
// shuffle, and "New cities" actually meaning new cities. Those went with
// the wheel, along with drawWheel, INITIAL_WHEEL and WHEEL_SLICES, which
// by then had no callers left but these tests. Tests are the last thing
// that should keep dead code alive: a module with a passing suite and no
// users reads as load-bearing to whoever finds it next.
//
// What is left is what the dart still depends on. The naming checks are
// the valuable ones and they are unchanged: a slug with no Bulgarian name
// renders a blank where a city should be, and SPIN_POOL feeds the guide
// links on a dart result.
//
// Run: npm run test:spin

import { spinCityName, SPIN_POOL } from "./spin";
import { check, finish, heading, section } from "./testutil";

heading("guide cities");

function main() {
  {
    section("the pool");

    check("every city with a guide and a photo", SPIN_POOL.length === 24, String(SPIN_POOL.length));
    check("no duplicates", new Set(SPIN_POOL).size === SPIN_POOL.length);
  }

  {
    section("names");

    check("a slug title-cases", spinCityName("rome", "en") === "Rome");
    check("  including the one with a separator", spinCityName("new_york", "en") === "New York");
    check("bg comes from the guides' own map", spinCityName("rome", "bg") === "Рим");
    check("  and falls back to English when there is none", spinCityName("chicago", "bg") === "Chicago");
    // A dart landing on a country with guides lists them by these names, so
    // a slug with no name in one language renders a blank button.
    for (const slug of SPIN_POOL) {
      check(
        `${slug} is named in both languages`,
        spinCityName(slug, "en").length > 0 && spinCityName(slug, "bg").length > 0
      );
    }
  }

  finish();
}

main();
