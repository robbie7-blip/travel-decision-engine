// Portraits for the Ask a Local voices.
//
// Drawn rather than photographed, and deliberately stylised: a
// photographic face would read as a claim that a particular person is
// answering, which is exactly the thing the prompt refuses to do. These
// are characters, the way a role on a map legend is a character - and the
// three human ones have no face at all. The window and the pair of
// walkers carry a blank circle for a head; the cook's apron and pan say
// cook without anybody needing eyes. The owl has eyes because an owl is
// not a claim about a person.
//
// The drawings themselves are generated art, normalised into one path
// each: see components/voiceAvatarArt.ts for what the generator gives us
// and scripts/makeVoiceAvatarArt.ts for how it becomes this. They
// replaced four hand-drawn monoline sketches, which were honest but read
// as placeholders.
//
// WHAT THIS FILE OWNS IS THE COLOUR, and that split is the point. The art
// arrives with none: pure linework, no fills, no palette. Here it gets
// currentColor for the lines and one accent from the existing six-colour
// palette for the disc behind, so four characters in a row read as four
// people without introducing four new hues - and so a portrait inverts
// cleanly when its card is selected, which a coloured drawing could not
// do. An earlier batch that asked the generator for the colour came back
// with two voices on the same disc, hues that were not in the palette,
// and linework that disappeared against a dark card.

import { VOICE_AVATAR_ART, VOICE_AVATAR_VIEWBOX } from "./voiceAvatarArt";

export type VoiceAvatarProps = {
  size?: number;
  /** Selected state: the card is filled with --brand-teal and its
   * foreground is white, so the linework follows currentColor to white on
   * its own and the disc has to lift to something readable on green. */
  inverted?: boolean;
};

type VoiceKey = keyof typeof VOICE_AVATAR_ART;

const ACCENTS: Record<VoiceKey, string> = {
  neighbour: "var(--brand-teal)",
  cook: "var(--brand-coral)",
  night: "var(--brand-purple)",
  family: "var(--brand-gold)",
};

/** On a selected card the background is already --brand-teal, so a teal
 * or purple disc on top of it is invisible and a gold one fights it.
 * Translucent white is the only thing that reads as the same disc on
 * every one of the four. */
const INVERTED_DISC = "rgba(255,255,255,0.22)";

/** How much of the accent shows through. Low, because the linework is
 * the drawing and the disc is only there to tell four portraits apart at
 * a glance; dark mode gets a little more because the same alpha over a
 * dark ground reads as almost nothing. */
const DISC_OPACITY = 0.16;

/** Matches `inner` in AVATAR_POLICY: the art is framed to 150 of 256, so
 * a disc of 110 contains it with a little air at the sides and the two
 * drawings that are wider than they are tall sit across it rather than
 * bursting out. */
const DISC_RADIUS = 110;

function VoiceAvatar({
  voice,
  size = 44,
  inverted = false,
}: VoiceAvatarProps & { voice: VoiceKey }) {
  const centre = 128;
  return (
    <svg
      width={size}
      height={size}
      viewBox={VOICE_AVATAR_VIEWBOX}
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle
        cx={centre}
        cy={centre}
        r={DISC_RADIUS}
        fill={inverted ? INVERTED_DISC : ACCENTS[voice]}
        opacity={inverted ? 1 : DISC_OPACITY}
      />
      {/* evenodd is load-bearing, not a default. The generator draws the
          insides of every shape as separate white paths laid on top; they
          are merged into this one path, and under evenodd they punch
          holes instead of painting. Switch to nonzero and the portraits
          become opaque silhouettes - the owl a black blob, the cook's
          apron a slab - with the disc behind them knocked out. */}
      <path fill="currentColor" fillRule="evenodd" d={VOICE_AVATAR_ART[voice]} />
    </svg>
  );
}

/** The neighbour: someone leaning out of a window, because the whole
 * character is the person who watches this street go by every day. */
export function NeighbourAvatar(props: VoiceAvatarProps) {
  return <VoiceAvatar voice="neighbour" {...props} />;
}

/** The cook: an apron and a pan held level, herbs in it. */
export function CookAvatar(props: VoiceAvatarProps) {
  return <VoiceAvatar voice="cook" {...props} />;
}

/** Someone up late: an owl on a branch under a crescent moon. Literal on
 * purpose - "night owl" is the phrase, and a bird carries the idea
 * without standing in for a particular person. */
export function NightAvatar(props: VoiceAvatarProps) {
  return <VoiceAvatar voice="night" {...props} />;
}

/** A parent: two heights walking away hand in hand, seen from behind. */
export function FamilyAvatar(props: VoiceAvatarProps) {
  return <VoiceAvatar voice="family" {...props} />;
}

export const VOICE_AVATARS = {
  neighbour: NeighbourAvatar,
  cook: CookAvatar,
  night: NightAvatar,
  family: FamilyAvatar,
} as const;
