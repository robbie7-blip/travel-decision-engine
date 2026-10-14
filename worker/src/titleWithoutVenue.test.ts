// A rejected venue leaves the title as well as the item's fields.
//
// Run: npm run test:title-without-venue

import { titleWithoutVenue, stripToUnverified } from "./engine/venueVerification";
import { check, finish, heading } from "./testutil";
import type { ItineraryItem } from "./types";

heading("a rejected venue's name comes out of the title");

// The real one: a repaired breakfast that failed the 4.3 bar.
check(
  "the Rome case",
  titleWithoutVenue("Quick coffee and cornetto at Roscioli Caffè", "Roscioli Caffè Pasticceria") ===
    "Quick coffee and cornetto",
  titleWithoutVenue("Quick coffee and cornetto at Roscioli Caffè", "Roscioli Caffè Pasticceria")
);
check("exact name", titleWithoutVenue("Dinner at Da Enzo al 29", "Da Enzo al 29") === "Dinner");
check("in the middle", titleWithoutVenue("Coffee at Sant'Eustachio before the Pantheon", "Sant'Eustachio") === "Coffee before the Pantheon");
check("Bulgarian", titleWithoutVenue("Вечеря в Da Enzo al 29", "Da Enzo al 29") === "Вечеря", titleWithoutVenue("Вечеря в Da Enzo al 29", "Da Enzo al 29"));
check("a dash", titleWithoutVenue("Lunch - Armando al Pantheon", "Armando al Pantheon") === "Lunch");
check("any case", titleWithoutVenue("lunch at ARMANDO", "Armando") === "lunch");
// Left alone when there is nothing safe to do.
check("name not in the title", titleWithoutVenue("Lunch in Monti", "Armando") === "Lunch in Monti");
check("title is only the name", titleWithoutVenue("Roscioli", "Roscioli") === "Roscioli");
check("no venue", titleWithoutVenue("Lunch", null) === "Lunch");
// A short first word must not cut a common word out of the title.
check("short names are not matched loosely", titleWithoutVenue("Lunch at the market", "Da Mario") === "Lunch at the market");

// Through stripToUnverified: meals lose the name, lodging keeps its line.
const meal = { type: "meal", title: "Dinner at Il Sorpasso", venue_name: "Il Sorpasso", time: "20:00" } as ItineraryItem;
stripToUnverified(meal);
check("a stripped meal loses the name from its title", meal.title === "Dinner" && meal.venue_name === null, meal.title);
const lodging = { type: "lodging", title: "Hotel Raphael", venue_name: "Hotel Raphael", time: "21:00" } as ItineraryItem;
stripToUnverified(lodging);
check("a stripped lodging line keeps its title", lodging.title === "Hotel Raphael" && lodging.venue_name === null);

finish();
