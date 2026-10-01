import Link from "next/link";
import { HouseGlyph } from "./HouseGlyph";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

/** The way home, as a house, next to the wordmark.
 *
 * Home went into the nav row first, which was right for desktop and
 * invisible on a phone: the nav row collapses behind the Menu button
 * there, so the house only existed for someone who already knew to tap
 * Menu and look. Reported from a phone as, simply, "there's no house".
 *
 * WHY BESIDE THE LOGO rather than in the chip group on the right. The
 * group is nowrap and already measured at 316px of the 326px a 390px
 * phone has; a fifth chip makes it 362 and something has to give - the
 * squeeze that wrapped "Menu" onto two lines last week. Row 1's left-hand
 * side has the wordmark and nothing else, and on a phone the group wraps
 * to its own line anyway, so there is no width pressure here on any page.
 * It also puts the house immediately next to the thing it duplicates,
 * which is the point: the complaint was that returning home depended on
 * knowing the wordmark is clickable, and an explicit button an inch away
 * from it says so out loud.
 *
 * Icon-only, with the label as the accessible name. A house needs no
 * caption, and a labelled chip here would cost the width the group does
 * not have if this ever moves into it. */
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
