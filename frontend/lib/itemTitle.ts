// The line a trip item is shown under, with its venue in it.
//
// A checked restaurant or sight carries its name in venue_name, and the
// worker usually writes it into the title too ("Dinner: Taberna da Rua
// das Flores"). When it did not ("Dinner", venue in venue_name only), the
// page showed just "Dinner" and the place it had checked was nowhere to
// be seen. The name is added when the title does not already say it,
// whole or by its first two words (titles often use a short form).
//
// Run: npm run test:item-title

export function itemTitle(item: { title?: unknown; venue_name?: unknown }): string {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const venue = typeof item.venue_name === "string" ? item.venue_name.trim() : "";
  if (!venue) return title;
  if (!title) return venue;
  const lower = title.toLocaleLowerCase();
  const short = venue.split(/\s+/).slice(0, 2).join(" ");
  if (lower.includes(venue.toLocaleLowerCase()) || (short.length >= 4 && lower.includes(short.toLocaleLowerCase()))) return title;
  return `${title}: ${venue}`;
}
