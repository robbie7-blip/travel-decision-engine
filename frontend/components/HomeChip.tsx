import Link from "next/link";
import { HouseGlyph } from "./HouseGlyph";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

/** The way home, as a house, in the control group beside Menu.
 *
 * It took three attempts to land, and the two wrong ones are worth
 * recording because each was wrong for a different reason.
 *
 * First the nav row: right on desktop, invisible on a phone, because that
 * row collapses behind the Menu button there. Reported back as "there's no
 * house". Then beside the wordmark, which solved visibility and broke
 * something more important - the logo lockup is not mine to add things to.
 * "Logo should be untouched."
 *
 * So: inside .header-account-group, immediately before Menu, which is
 * where it was asked to go and is also the honest place for it. That box
 * already holds every control that is about the site rather than about the
 * page, and the house is one of those.
 *
 * The cost is width, and it is handled rather than hoped away. The group
 * is nowrap; four chips measure 316px of the 326px a 390px phone gives
 * it, so a fifth makes it 362. On the two pages that also show the
 * currency - a trip and a comparison, where prices are on screen - the
 * currency drops to its own line under 425px, by the same rule that
 * already does this below 345px. Everywhere else the house is the fourth
 * chip and the row is 286px, which fits with room to spare.
 *
 * Icon-only, with the label as its accessible name: a house needs no
 * caption, and the label would cost width the group does not have. */
export function HomeChip({ language, t }: { language: Language; t: Dictionary }) {
  const langSuffix = language === "bg" ? "?lang=bg" : "";
  return (
    <Link
      href={`/${langSuffix}`}
      className="header-chip home-chip"
      aria-label={t.navHome}
      title={t.navHome}
    >
      <HouseGlyph size={17} />
    </Link>
  );
}
