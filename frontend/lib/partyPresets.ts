// The "Who" segment of the homepage search bar, as data.
//
// The trip form asks two questions about the party - how many, and a free
// text description - and both are required (lib/validation.ts), because
// "two adults" and "two adults and a toddler" are different trips. The bar
// has room for neither as a text field, so it offers the four answers most
// people would type and writes BOTH fields from one tap. The full form
// below is the same state, so anyone whose party is not one of these four
// can still describe it in their own words, and the bar then leaves that
// description alone.
//
// Pure, so the rules are tested rather than eyeballed.
//
// Run: npm run test:party-presets

import { TRANSLATIONS } from "./i18n";
import type { Language } from "./types";

export const PARTY_PRESETS = ["solo", "couple", "family", "friends"] as const;
export type PartyPreset = (typeof PARTY_PRESETS)[number];

export const MAX_PARTY = 50;

export interface Party {
  party_size: string;
  party_composition: string;
}

function normalise(text: string): string {
  return text.trim().toLocaleLowerCase();
}

/** Which preset this description is, in EITHER language, or null when it
 * is something the traveller wrote themselves.
 *
 * Either language because the language switch can happen after the tap:
 * "couple" chosen in English is still the couple preset once the page is
 * in Bulgarian, and translatePartyComposition below relies on that. */
export function presetOf(composition: string): PartyPreset | null {
  const wanted = normalise(composition);
  if (!wanted) return null;
  for (const language of Object.keys(TRANSLATIONS) as Language[]) {
    const presets = TRANSLATIONS[language].heroSearch.presets;
    for (const key of PARTY_PRESETS) {
      if (normalise(presets[key].party) === wanted) return key;
    }
  }
  return null;
}

/** The party size as a number, or 0 when the field is empty or nonsense. */
export function partySizeOf(party: Party): number {
  const n = Number.parseInt(party.party_size, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PARTY) : 0;
}

/** Tapping a preset. Solo and couple fix the number; family and friends
 * keep a number that already fits them and otherwise start at three, the
 * smallest party either word usually means. */
export function applyPreset(party: Party, preset: PartyPreset, language: Language): Party {
  const size = partySizeOf(party);
  const next =
    preset === "solo" ? 1 : preset === "couple" ? 2 : size >= 3 ? size : 3;
  return {
    party_size: String(next),
    party_composition: TRANSLATIONS[language].heroSearch.presets[preset].party,
  };
}

/** The - and + buttons.
 *
 * The preset follows the number where the number makes it untrue: one
 * person is not a couple, and three are not one. A description the
 * traveller wrote themselves is never touched - only they know whether
 * "me and my sister" is still right with a third person in it. */
export function stepParty(party: Party, delta: number, language: Language): Party {
  const current = partySizeOf(party) || 1;
  const size = Math.max(1, Math.min(MAX_PARTY, current + delta));
  const preset = presetOf(party.party_composition);
  const presets = TRANSLATIONS[language].heroSearch.presets;

  let composition = party.party_composition;
  if (preset !== null || composition.trim() === "") {
    let nextPreset: PartyPreset = preset ?? "couple";
    if (size === 1) nextPreset = "solo";
    else if (nextPreset === "solo") nextPreset = size === 2 ? "couple" : "friends";
    else if (nextPreset === "couple" && size > 2) nextPreset = "friends";
    composition = presets[nextPreset].party;
  }

  return { party_size: String(size), party_composition: composition };
}

/** On a language switch, a preset follows the page into the new language;
 * anything the traveller typed stays exactly as they typed it. */
export function translatePartyComposition(composition: string, to: Language): string {
  const preset = presetOf(composition);
  return preset === null ? composition : TRANSLATIONS[to].heroSearch.presets[preset].party;
}

/** "2 travelers", or "" when there is no usable number yet. */
export function travelerCount(party: Party, language: Language): string {
  const size = partySizeOf(party);
  if (size === 0) return "";
  const copy = TRANSLATIONS[language].heroSearch;
  return size === 1 ? copy.travelerOne : copy.travelerMany.replace("{count}", String(size));
}
