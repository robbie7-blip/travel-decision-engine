// Run: npm run test:item-title

import { itemTitle } from "./itemTitle";
import { check, finish, heading } from "./testutil";

heading("an item's title shows its venue");
check("venue only in venue_name is shown", itemTitle({ title: "Dinner", venue_name: "Taberna da Rua das Flores" }) === "Dinner: Taberna da Rua das Flores");
check("already in the title, not repeated", itemTitle({ title: "Dinner: Taberna da Rua das Flores", venue_name: "Taberna da Rua das Flores" }) === "Dinner: Taberna da Rua das Flores");
check("a short form in the title counts", itemTitle({ title: "Coffee at Roscioli Caffè", venue_name: "Roscioli Caffè Pasticceria" }) === "Coffee at Roscioli Caffè");
check("case does not matter", itemTitle({ title: "Lunch at PASTÉIS DE BELÉM", venue_name: "Pastéis de Belém" }) === "Lunch at PASTÉIS DE BELÉM");
check("no venue, the title as it is", itemTitle({ title: "Walk Alfama", venue_name: null }) === "Walk Alfama");
check("no title, the venue", itemTitle({ title: "", venue_name: "Jerónimos Monastery" }) === "Jerónimos Monastery");
check("nonsense values do not break it", itemTitle({ title: 3, venue_name: {} }) === "");
finish();
