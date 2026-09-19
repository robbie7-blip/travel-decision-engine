// The destinations field's suggestion logic.
//
// The point of the whole change is that this field became easier to use
// WITHOUT becoming a closed list, so the assertions that matter most are the
// ones about a city that is not on the list: it still goes in, it still
// leaves the value in the one comma-separated shape the rest of the app
// reads, and nothing that worked before stops working.
//
// Run: npm run test:city-options

import {
  addCity,
  CITY_OPTIONS,
  cityLabel,
  filterCityOptions,
  joinCities,
  splitCities,
} from "./cityOptions";
import { airportsFor } from "./airports";
import { COUNTRIES } from "./countries";
import { parseTripBrief } from "./validation";
import { check, finish, heading, section } from "./testutil";

heading("destination suggestions");

const names = () => CITY_OPTIONS.map((o) => o.name);

function main() {
  {
    section("the list is the cities this product knows something extra about");

    check("it is not empty", CITY_OPTIONS.length > 30, String(CITY_OPTIONS.length));
    check("every option has a country", CITY_OPTIONS.every((o) => o.country.length > 0));
    check("no duplicates", new Set(names()).size === CITY_OPTIONS.length);
    check("sorted, so the list is scannable", JSON.stringify(names()) === JSON.stringify([...names()].sort((a, b) => a.localeCompare(b, "en"))));

    // The claim in the header comment, checked rather than asserted: every
    // multi-airport city is suggestable, because those are exactly the ones
    // where picking from the list unlocks the airport dropdown.
    const multiAirport = names().filter((name) => airportsFor(name).length >= 2);
    check("multi-airport cities are in the list", multiAirport.length >= 25, String(multiAirport.length));
    for (const name of ["Rome", "London", "Paris", "New York", "Milan", "Sao Paulo", "Washington"]) {
      check(`${name} resolves to an airport list`, airportsFor(name).length >= 2, String(airportsFor(name).length));
    }

    // Spelled exactly as the airport table's keys, which is the whole
    // reason a pick is better than typing. A name that looked right but
    // did not resolve would be the silent version of this feature not
    // working.
    const unresolvable = CITY_OPTIONS.filter((o) => airportsFor(o.name).length === 1);
    check("no option resolves to a single-airport stub", unresolvable.length === 0, JSON.stringify(unresolvable.map((o) => o.name)));
  }

  {
    section("it covers the places people type");

    // The list used to be 43: the 24 curated cities plus the 19 the airport
    // table happens to know about. Not a list of places travelers name -
    // two other lists glued together. It showed the day somebody typed
    // "Sofia", this product's own example origin, in a product that ships
    // in Bulgarian, and was told it was "not on the list".
    check("the list is a few hundred, not a few dozen", CITY_OPTIONS.length > 200, String(CITY_OPTIONS.length));

    // The home market first, because that is where the gap was found.
    for (const name of ["Sofia", "Plovdiv", "Varna", "Burgas"]) {
      check(`${name} is suggestable`, names().includes(name));
    }

    // Every European capital, which is the bar a travel product in Europe
    // has to clear. Sampled across the continent rather than listed in
    // full - the point is the shape of the coverage, not a second copy of
    // the data.
    for (const name of [
      "Dublin", "Warsaw", "Bucharest", "Belgrade", "Zagreb", "Ljubljana", "Bratislava",
      "Tallinn", "Riga", "Vilnius", "Helsinki", "Reykjavik", "Kyiv", "Valletta", "Nicosia",
      "Sarajevo", "Skopje", "Podgorica", "Tirana", "Bern", "Luxembourg", "Ankara",
    ]) {
      check(`${name} is suggestable`, names().includes(name), name);
    }

    // And the places the rest of the world goes.
    for (const name of ["Sydney", "Cape Town", "Marrakech", "Hanoi", "Kyoto", "Vancouver", "Lima", "Tel Aviv"]) {
      check(`${name} is suggestable`, names().includes(name), name);
    }

    // The free-text path is the reason this list does NOT have to be
    // exhaustive, and it has to keep working - a closed list would mean
    // the engine can no longer plan the trip this product was built to
    // plan. Asserted here next to the coverage so the two are read
    // together.
    check("a city nobody listed is still nothing to the filter", filterCityOptions("Chisinau-by-the-sea", "en").length === 0);
  }

  {
    section("every country is one the app itself recognises");

    // A hand-written list of a few hundred cities is exactly where a wrong
    // country slips in, and "Sofia, Romania" in a travel product is worse
    // than offering no suggestion at all. So the country strings are
    // checked against lib/countries.ts - the app's own 197-entry dataset,
    // which is already the source of truth for the visited tracker - not
    // against a reviewer's memory.
    //
    // This caught one on its first run that predates the new list:
    // Istanbul was filed under "Türkiye", which is not the spelling the
    // rest of the app uses.
    const known = new Set(COUNTRIES.map((c) => c.name));
    const wrong = CITY_OPTIONS.filter((o) => !known.has(o.country));
    check(
      "no city names a country the app does not know",
      wrong.length === 0,
      JSON.stringify(wrong.map((o) => `${o.name} -> ${o.country}`))
    );
  }

  {
    section("labels are display only, values are always English");

    // destinationCityNamesBg.ts's own rule: the canonical English name is
    // what the engine matches against, so a Bulgarian label must never
    // become the value.
    const rome = CITY_OPTIONS.find((o) => o.name === "Rome");
    check("rome exists", rome !== undefined);
    if (rome) {
      check("en shows the English name", cityLabel(rome, "en") === "Rome");
      check("bg shows the Bulgarian one", cityLabel(rome, "bg") === "Рим", cityLabel(rome, "bg"));
      check("but the value is unchanged", rome.name === "Rome");
    }

    // The 19 airport-only cities have no reviewed Bulgarian name and fall
    // back to English rather than getting one invented here.
    const chicago = CITY_OPTIONS.find((o) => o.name === "Chicago");
    check("an unlabelled city falls back to English", chicago !== undefined && cityLabel(chicago, "bg") === "Chicago");

    // No label may be blank in either language - a blank option is an
    // unclickable row.
    for (const option of CITY_OPTIONS) {
      check(`${option.name} has both labels`, cityLabel(option, "en").length > 0 && cityLabel(option, "bg").length > 0);
    }
  }

  {
    section("filtering");

    check("an empty query offers something", filterCityOptions("", "en").length > 0);
    check("  bounded by the limit", filterCityOptions("", "en", [], 5).length === 5);

    // Prefix before contains. "to" is the honest example: Tokyo and Toronto
    // start with it, Stockholm and Washington merely contain it. (My first
    // attempt at this assertion used "ven" expecting Vienna to be a
    // contained match - it is not, there is no "ven" in "Vienna", and the
    // test went red for the right reason.)
    const to = filterCityOptions("to", "en", [], 20).map((o) => o.name);
    check("prefix matches come first", to[0] === "Tokyo" && to[1] === "Toronto", JSON.stringify(to));
    check("  and contained ones follow", to.includes("Stockholm") && to.includes("Washington"), JSON.stringify(to));
    check("  in that order", to.indexOf("Toronto") < to.indexOf("Stockholm"), JSON.stringify(to));

    check("case is ignored", filterCityOptions("rOmE", "en")[0]?.name === "Rome");
    check("diacritics are folded", filterCityOptions("sao", "en").some((o) => o.name === "Sao Paulo"));

    // A traveller who remembers the country and not the city.
    const italy = filterCityOptions("italy", "en", [], 20).map((o) => o.name);
    check("country matches work", italy.includes("Rome") && italy.includes("Florence"), JSON.stringify(italy));
    check("  and a country prefix too", filterCityOptions("ital", "en", [], 20).length === italy.length);

    // ...but by PREFIX only. Substring-matching the country made short
    // queries useless: "an" offered Amsterdam, Berlin and Munich, because
    // "Netherlands" and "Germany" both contain "an".
    //
    // The limit is high on purpose. At 30 this read `an.includes("Milan")`
    // and started failing the moment the list grew past a few dozen
    // cities - not because the rule broke, but because prefix matches
    // ("Ankara", "Antwerp", "Andorra la Vella") now fill the first 30 and
    // the contains-matches rank after them, exactly as intended. The
    // assertion is about ORDERING and what is excluded, so it must not be
    // measured through a cut-off.
    const an = filterCityOptions("an", "en", [], 400).map((o) => o.name);
    check("a country is not matched mid-word", an.includes("Berlin") === false, JSON.stringify(an.slice(0, 20)));
    check("  nor Amsterdam via Netherlands", an.includes("Amsterdam") === false, JSON.stringify(an.slice(0, 20)));
    check("  while the city names that do contain it are kept", an.includes("Milan") && an.includes("Bangkok"), JSON.stringify(an.slice(0, 20)));
    check("  and a prefix match is offered before a contains match", an.indexOf("Ankara") < an.indexOf("Milan"), JSON.stringify(an.slice(0, 6)));

    // A Bulgarian reader typing Cyrillic - which before this change found
    // nothing and produced no airport dropdown.
    check("bg labels are searchable", filterCityOptions("Рим", "bg")[0]?.name === "Rome");
    check("  and English still works in bg", filterCityOptions("Rome", "bg")[0]?.name === "Rome");

    // Already-chosen cities are excluded, not greyed out: an option that
    // does nothing when clicked is worse than no option.
    check("a chosen city is not offered again", filterCityOptions("rome", "en", ["Rome"]).length === 0);
    check("  case-insensitively", filterCityOptions("rome", "en", ["ROME"]).length === 0);
    check("a nonsense query offers nothing", filterCityOptions("zzzzz", "en").length === 0);
  }

  {
    section("the value stays one comma-separated string");

    // This is the compatibility contract. validation.ts splits on commas,
    // the guide pages' ?dest= link writes that shape, and flight import
    // writes it too.
    check("split", JSON.stringify(splitCities("Brussels, Bruges")) === '["Brussels","Bruges"]');
    check("  tolerates extra spacing", JSON.stringify(splitCities(" Rome ,  Florence ")) === '["Rome","Florence"]');
    check("  and empty entries", JSON.stringify(splitCities("Rome,,Florence,")) === '["Rome","Florence"]');
    check("  an empty value is no cities", splitCities("").length === 0);
    check("  and so is a comma alone", splitCities(", ,").length === 0);
    check("join", joinCities(["Rome", "Florence"]) === "Rome, Florence");
    check("round trip", joinCities(splitCities("Brussels, Bruges")) === "Brussels, Bruges");

    // And what comes out is still a brief the validator accepts.
    const brief = parseTripBrief({
      destinations: joinCities(["Rome", "Florence"]).split(",").map((c) => c.trim()),
      start_date: "2027-05-01",
      end_date: "2027-05-04",
      party_size: 2,
      party_composition: "couple",
      pace: "moderate",
      language: "en",
    });
    check("the chips produce a valid brief", brief.destinations.join(",") === "Rome,Florence");
  }

  {
    section("adding a city");

    check("adds", JSON.stringify(addCity(["Rome"], "Florence")) === '["Rome","Florence"]');
    check("trims", JSON.stringify(addCity([], "  Rome  ")) === '["Rome"]');
    check("ignores blank", JSON.stringify(addCity(["Rome"], "   ")) === '["Rome"]');

    // A duplicate destination is a real defect downstream, not just an
    // untidy chip: it would put the city in the brief twice and let the
    // plan spend days on it twice.
    check("refuses an exact duplicate", JSON.stringify(addCity(["Rome"], "Rome")) === '["Rome"]');
    check("  a different case", JSON.stringify(addCity(["Rome"], "rome")) === '["Rome"]');
    check("  and one with spacing", JSON.stringify(addCity(["Rome"], " ROME ")) === '["Rome"]');
    check("  or a differing accent", JSON.stringify(addCity(["Sao Paulo"], "São Paulo")) === '["Sao Paulo"]');

    // THE case the whole design turns on: a city that is not on the
    // suggestion list goes in untouched.
    //
    // DERIVED, not hard-coded. This used to name Tbilisi, which is now ON
    // the list - it is a European capital, and the list grew to cover
    // those. A fixed example silently stops testing what it says the
    // moment the suggestions catch up with it, which is the worst way for
    // an assertion to fail: by passing. So the list is asked for a name it
    // does not have.
    const offList = ["Tbilisi", "Veliko Tarnovo", "Kotor", "Nowhere-on-Sea"].find((n) => !names().includes(n)) ?? "Nowhere-on-Sea";
    check(`${offList} is genuinely not on the list`, !names().includes(offList), offList);
    check("  a city not on the list is accepted", JSON.stringify(addCity([], offList)) === JSON.stringify([offList]));
    check("  and the filter offers nothing for it", filterCityOptions(offList, "en").length === 0);
    check(
      "  and survives into the value",
      joinCities(addCity(addCity([], "Tbilisi"), "Kutaisi")) === "Tbilisi, Kutaisi"
    );
  }

  finish();
}

main();
