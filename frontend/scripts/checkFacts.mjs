// The curated facts base exists in THREE places, and they must hold the
// same cities.
//
// facts/ at the repository root is the source of truth. frontend/facts/ is
// copied in "so the app is self-contained" (README), and worker/facts/ is
// copied in for the same reason - the worker is a separate deploy on
// Railway with its own working directory, so it cannot read the root one.
//
// Nothing compared them, and they had drifted. The worker held 18 files
// against the root's 24, missing bangkok, dubai, mexico_city, new_york,
// singapore and tokyo - every non-European destination. The worker is the
// process that GENERATES the itinerary, so for those six cities loadFacts
// returned nothing and the model worked from memory alone, while the
// frontend's own copy still fed the loading screen "Did you know?" trivia
// for them. The product looked grounded on exactly the trips that were not.
//
// It is invisible from either side: the generation succeeds, the page
// renders, and the only trace is that no item on those trips can ever reach
// the fact_grounded confidence tier. "Can an LLM, grounded in a small
// curated fact base, produce itineraries good enough to trust" is the
// hypothesis this whole product is testing - a city silently missing from
// the base on the one side that does the generating invalidates the answer
// for that city.
//
// Contents are compared too, not just filenames: a copy that has the right
// name and stale text is the same failure wearing a better disguise.
//
// Run: npm run check:facts

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");

const SOURCE = "facts";
const COPIES = ["frontend/facts", "worker/facts"];

const jsonFiles = (dir) =>
  readdirSync(resolve(ROOT, dir))
    .filter((f) => f.endsWith(".json"))
    .sort();

const source = jsonFiles(SOURCE);
if (source.length === 0) {
  console.error(`No .json files in ${SOURCE}/ - is this running from the right place?`);
  process.exit(1);
}

let failed = 0;

for (const copy of COPIES) {
  const have = jsonFiles(copy);

  const missing = source.filter((f) => !have.includes(f));
  const extra = have.filter((f) => !source.includes(f));

  if (missing.length > 0) {
    failed++;
    console.error(`\n${copy}/ is MISSING ${missing.length} of ${source.length} curated cities:`);
    for (const f of missing) console.error(`    ${f}`);
    console.error(`  fix: cp ${missing.map((f) => `${SOURCE}/${f}`).join(" ")} ${copy}/`);
  }

  if (extra.length > 0) {
    failed++;
    console.error(`\n${copy}/ has ${extra.length} file(s) not in ${SOURCE}/:`);
    for (const f of extra) console.error(`    ${f}`);
    console.error(`  fix: add them to ${SOURCE}/ (the source of truth) or delete them from ${copy}/`);
  }

  const differing = source
    .filter((f) => have.includes(f))
    .filter(
      (f) =>
        readFileSync(resolve(ROOT, SOURCE, f), "utf8") !== readFileSync(resolve(ROOT, copy, f), "utf8")
    );

  if (differing.length > 0) {
    failed++;
    console.error(`\n${copy}/ has ${differing.length} file(s) whose CONTENTS differ from ${SOURCE}/:`);
    for (const f of differing) console.error(`    ${f}`);
    console.error(`  fix: cp ${differing.map((f) => `${SOURCE}/${f}`).join(" ")} ${copy}/`);
  }
}

if (failed > 0) {
  console.error(`\nThe curated facts base has drifted between copies.\n`);
  process.exit(1);
}

console.log(
  `All ${source.length} curated facts files are present and identical in ${COPIES.join(" and ")}.`
);
