// The full world city list behind the destination and origin fields.
//
// Run: npm run test:world-cities

import { latinise, searchCities, worldCities } from "./worldCities";
import { mergeCitySuggestions } from "./cityOptions";
import { check, finish, heading, section } from "./testutil";

heading("world city suggestions");

const index = worldCities();
const first = (q: string, lang: "en" | "bg" = "en") => searchCities(index, q, lang)[0];

section("the list");
{
  check("about a hundred thousand places", index.length > 100_000, String(index.length));
  check("largest first", index[0].row[2] >= index[1].row[2] && index[1].row[2] >= index[100].row[2]);
}

section("small towns are suggestions, not 'not on the list'");
{
  check("Friedrichshafen", first("Friedrichshaf")?.name === "Friedrichshafen" && first("Friedrichshaf")?.country === "Germany");
  check("Zermatt", first("zerma")?.name === "Zermatt");
  check("Sozopol", first("sozop")?.name === "Sozopol");
}

section("the biggest place with a name comes first, and is the bare name");
{
  const paris = searchCities(index, "paris", "en");
  check("Paris is Paris, France", paris[0].name === "Paris" && paris[0].country === "France" && paris[0].value === "Paris");
  const texas = paris.find((c) => c.country === "United States");
  check("a smaller Paris says which one", texas?.value === "Paris, United States", texas?.value);
  check("Rome is Rome, Italy", first("rome")?.value === "Rome" && first("rome")?.country === "Italy");
}

section("English names, and the local ones still find them");
{
  check("Cologne", first("colog")?.name === "Cologne");
  check("Köln finds Cologne", first("köln")?.name === "Cologne");
  check("Seville", first("sevil")?.name === "Seville" && first("sevil")?.country === "Spain");
  check("Nuremberg", first("nurem")?.name === "Nuremberg");
  check("Bruges", first("bruge")?.name === "Bruges" && first("bruge")?.country === "Belgium");
}

section("accents and words");
{
  check("zurich finds Zürich", first("zurich")?.name === "Zürich");
  check("krakow finds Kraków", first("krakow")?.name === "Kraków");
  check("a word inside the name", searchCities(index, "sebast", "en").some((c) => c.name === "San Sebastián"));
  check("one letter is not a search", searchCities(index, "p", "en").length === 0);
}

section("Bulgarian");
{
  check("Cyrillic spelled the same way works", first("Тбилиси", "bg")?.name === "Tbilisi");
  check("country names in Bulgarian", first("Friedrichshaf", "bg")?.country === "Германия");
  check("transliteration", latinise("Щъркел") === "shtarkel");
}

section("merged under the short list without repeats");
{
  const merged = mergeCitySuggestions(
    [{ name: "Rome", country: "Italy" }],
    [{ name: "Rome", country: "Italy", value: "Rome" }, { name: "Rome", country: "United States", value: "Rome, United States" }],
    []
  );
  check("Rome once, then the other Rome", merged.length === 2 && merged[1].value === "Rome, United States");
  const chosen = mergeCitySuggestions([], [{ name: "Zermatt", country: "Switzerland", value: "Zermatt" }], ["zermatt"]);
  check("a city already chosen is not offered", chosen.length === 0);
}

finish();
