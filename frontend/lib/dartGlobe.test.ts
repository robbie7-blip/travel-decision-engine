// Throwing a dart at the globe.
//
// The honesty property is the one that matters and the one that is testable:
// the dart sticks inside the border it names. The wheel's whole design note
// is about not rigging the result, and a dart that says "Italy" while the
// marker sits in the Adriatic would be the same lie with better graphics.
//
// This file also reconciles the topology against the tracked country list,
// which is the check that would have saved me three probes and one wrong
// fix. Reading the polygon codes and seeing "CYP" and "SOM" beside a
// country list holding "CY" and "SO" looks exactly like a key mismatch. It
// is not - they are Northern Cyprus and Somaliland, drawn separately, and
// "correcting" CYP to CY would have given Cyprus two polygons, made clicking
// Northern Cyprus mark Cyprus visited, and left the two fighting over the
// colour. The assertion below states which is which, from the data.
//
// Run: npm run test:dart-globe

import {
  DART_TARGETS,
  DART_UNREACHABLE,
  dartCountryCodes,
  guidesForCountry,
  isInsideCountry,
  NON_COUNTRY_POLYGONS,
  sampleInside,
  SPIN_POOL,
  throwDart,
} from "./dartGlobe";
import { WORLD_COUNTRY_FEATURES } from "./worldGeo";
import { COUNTRIES, getCountry } from "./countries";
import { check, finish, heading, section } from "./testutil";

heading("dart at the globe");

/** Deterministic, so a claim about the dart is a claim about the dart. */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function main() {
  {
    section("the topology and the country list, reconciled");

    // Every polygon is either a tracked country or a declared territory.
    // Nothing may be neither - that is how a country goes silently missing
    // from the globe, which is the failure worldGeo.ts's header says it
    // chose one shared data source to avoid.
    const unexplained = WORLD_COUNTRY_FEATURES.map((f) => f.properties.I.toUpperCase()).filter(
      (code) => !getCountry(code) && !(code in NON_COUNTRY_POLYGONS)
    );
    check("every polygon is a country or a declared territory", unexplained.length === 0, JSON.stringify(unexplained));

    // The specific thing I got wrong. Cyprus and Somalia have their OWN
    // correct alpha-2 polygons; CYP and SOM are different places.
    const byCode = new Map(WORLD_COUNTRY_FEATURES.map((f) => [f.properties.I.toUpperCase(), f.properties.N]));
    check("CY is Cyprus", byCode.get("CY") === "Cyprus", String(byCode.get("CY")));
    check("SO is Somalia", byCode.get("SO") === "Somalia", String(byCode.get("SO")));
    check("CYP is Northern Cyprus, not a mis-keyed Cyprus", byCode.get("CYP") === "Northern Cyprus", String(byCode.get("CYP")));
    check("SOM is Somaliland, not a mis-keyed Somalia", byCode.get("SOM") === "Somaliland", String(byCode.get("SOM")));
    check("so both real countries are tracked", getCountry("CY") !== undefined && getCountry("SO") !== undefined);

    // No polygon may share a code with another, or two shapes fight over
    // one country's colour - which is what my wrong fix would have caused.
    const seen = new Map<string, number>();
    for (const f of WORLD_COUNTRY_FEATURES) {
      const code = f.properties.I.toUpperCase();
      seen.set(code, (seen.get(code) ?? 0) + 1);
    }
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([code]) => code);
    check("no two polygons share a code", duplicated.length === 0, JSON.stringify(duplicated));

    // Every declared territory actually exists in the data, so the list
    // cannot rot into describing polygons that are no longer there.
    for (const code of Object.keys(NON_COUNTRY_POLYGONS)) {
      check(`${code} (${NON_COUNTRY_POLYGONS[code]}) is really in the topology`, byCode.has(code));
      check(`  and is really untracked`, getCountry(code) === undefined);
    }
  }

  {
    section("what the dart can and cannot hit");

    check("there are targets", DART_TARGETS.length > 150, String(DART_TARGETS.length));
    check("every target is a tracked country", DART_TARGETS.every((t) => getCountry(t.code) !== undefined));
    check("every target has geometry", DART_TARGETS.every((t) => t.feature.geometry !== undefined));
    check("targets are sorted", JSON.stringify(dartCountryCodes()) === JSON.stringify([...dartCountryCodes()].sort()));
    check("no duplicates", new Set(dartCountryCodes()).size === DART_TARGETS.length);

    // The stated limit, asserted so it cannot quietly grow. These are the
    // microstates and island nations with no polygon in the topology.
    check("the unreachable list is small", DART_UNREACHABLE.length < 35, String(DART_UNREACHABLE.length));
    check("  and accounts for every tracked country", DART_TARGETS.length + DART_UNREACHABLE.length === COUNTRIES.length);
    check("Singapore is among them, as documented", DART_UNREACHABLE.includes("SG"));
    // ...and the big ones are definitely reachable.
    for (const code of ["IT", "FR", "JP", "US", "BR", "AU", "ZA", "IN", "MX", "TH", "GB", "BG"]) {
      check(`${code} is reachable`, dartCountryCodes().includes(code));
    }
  }

  {
    section("THE honesty property: the dart lands inside the border it names");

    // Every target, sampled, and the point checked against that country's
    // own polygon. Not a spot check - all of them, because the one that is
    // wrong is the one nobody thought of.
    const random = seeded(4242);
    const outside: string[] = [];
    for (const target of DART_TARGETS) {
      const { lat, lng } = sampleInside(target.feature, random);
      if (!isInsideCountry(lng, lat, target.feature)) outside.push(target.code);
    }
    check(
      `all ${DART_TARGETS.length} countries yield a point inside themselves`,
      outside.length === 0,
      JSON.stringify(outside)
    );

    // And through the real entry point, repeatedly.
    const throws = seeded(99);
    let checked = 0;
    let wrong = 0;
    for (let i = 0; i < 600; i++) {
      const hit = throwDart(throws);
      if (!hit) continue;
      const target = DART_TARGETS.find((t) => t.code === hit.code);
      if (!target) {
        wrong++;
        continue;
      }
      checked++;
      if (!isInsideCountry(hit.lng, hit.lat, target.feature)) wrong++;
    }
    check(`600 throws all landed in the country they named`, wrong === 0 && checked === 600, `${wrong} wrong of ${checked}`);
  }

  {
    section("a hit is a usable coordinate");

    const random = seeded(7);
    for (let i = 0; i < 300; i++) {
      const hit = throwDart(random);
      if (!hit) {
        check("a throw returned nothing", false);
        break;
      }
      if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) {
        check(`${hit.code} produced a non-finite coordinate`, false, JSON.stringify(hit));
        break;
      }
      if (hit.lat < -90 || hit.lat > 90 || hit.lng < -180 || hit.lng > 180) {
        check(`${hit.code} produced an off-globe coordinate`, false, JSON.stringify(hit));
        break;
      }
    }
    check("300 throws all produced finite, on-globe coordinates", true);
  }

  {
    section("every country gets a turn");

    // Uniform per country, deliberately: this answers "I have no idea where
    // to go", where San Marino deserves the same shot as Russia. Weighting
    // by area would make the dart a geography lesson about Siberia.
    const random = seeded(31337);
    const counts = new Map<string, number>();
    const throws = DART_TARGETS.length * 60;
    for (let i = 0; i < throws; i++) {
      const hit = throwDart(random);
      if (hit) counts.set(hit.code, (counts.get(hit.code) ?? 0) + 1);
    }
    check("every country came up at least once", counts.size === DART_TARGETS.length, `${counts.size} of ${DART_TARGETS.length}`);
    const expected = throws / DART_TARGETS.length;
    const worst = Math.max(...[...counts.values()].map((n) => Math.abs(n - expected) / expected));
    check("and none is favoured by more than 60%", worst < 0.6, `worst deviation ${(worst * 100).toFixed(0)}%`);
  }

  {
    section("naming the hit");

    check("Italy offers its three guides", guidesForCountry("IT").join(",") === "florence,rome,venice");
    check("Belgium offers two", guidesForCountry("BE").join(",") === "bruges,brussels");
    check("Japan offers one", guidesForCountry("JP").join(",") === "tokyo");
    check("case is ignored", guidesForCountry("it").length === 3);

    // The common case, and not an error: the form plans anywhere.
    check("Georgia has no guide", guidesForCountry("GE").length === 0);
    check("  nor does Mongolia", guidesForCountry("MN").length === 0);
    check("an unknown code has none", guidesForCountry("ZZ").length === 0);

    // Every guide must be reachable by name, so adding a facts file without
    // adding it here fails in CI rather than becoming a city the dart can
    // never announce.
    const mapped = new Set(COUNTRIES.flatMap((c) => guidesForCountry(c.code)));
    const unmapped = SPIN_POOL.filter((slug) => !mapped.has(slug));
    check("every guide city is in the country table", unmapped.length === 0, JSON.stringify(unmapped));
    check("  and none is listed twice", mapped.size === SPIN_POOL.length, `${mapped.size} vs ${SPIN_POOL.length}`);

    // Singapore's guide is mapped even though the dart cannot reach SG -
    // the table is about naming, not about reachability, and conflating the
    // two would quietly drop a real guide.
    check("Singapore's guide is still mapped", guidesForCountry("SG").join(",") === "singapore");
  }

  {
    section("point-in-polygon, on cases with a known answer");

    const italy = DART_TARGETS.find((t) => t.code === "IT")?.feature;
    check("italy has geometry", italy !== undefined);
    if (italy) {
      // Rome, and a point well out in the Tyrrhenian Sea.
      check("Rome is in Italy", isInsideCountry(12.5, 41.9, italy));
      check("the open sea west of Sardinia is not", isInsideCountry(6.0, 40.0, italy) === false);
      check("Paris is not in Italy", isInsideCountry(2.35, 48.86, italy) === false);
      check("the north pole is not", isInsideCountry(0, 90, italy) === false);
    }

    const france = DART_TARGETS.find((t) => t.code === "FR")?.feature;
    if (france) {
      check("Paris is in France", isInsideCountry(2.35, 48.86, france));
      check("  and Rome is not", isInsideCountry(12.5, 41.9, france) === false);
    }
  }

  finish();
}

main();
