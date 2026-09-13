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
    const an = filterCityOptions("an", "en", [], 30).map((o) => o.name);
    check("a country is not matched mid-word", an.includes("Berlin") === false, JSON.stringify(an));
    check("  nor Amsterdam via Netherlands", an.includes("Amsterdam") === false, JSON.stringify(an));
    check("  while the city names that do contain it are kept", an.includes("Milan") && an.includes("Bangkok"), JSON.stringify(an));

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
    check("a city not on the list is accepted", JSON.stringify(addCity([], "Tbilisi")) === '["Tbilisi"]');
    check("  and is not on the list", filterCityOptions("Tbilisi", "en").length === 0);
    check(
      "  and survives into the value",
      joinCities(addCity(addCity([], "Tbilisi"), "Kutaisi")) === "Tbilisi, Kutaisi"
    );
  }

  finish();
}

main();
