// Portraits for the Ask a Local voices.
//
// Drawn rather than photographed, and deliberately stylised: a photographic
// face would read as a claim that a particular person is answering, which
// is exactly the thing the prompt refuses to do. These are characters, the
// way a role on a map legend is a character.
//
// Same monoline vocabulary as the nav icons (NAV_ICONS in NavMenu.tsx):
// one stroke weight, round caps, currentColor for the linework so a
// portrait inverts cleanly when its card is selected. Each carries one
// accent from the existing six-colour palette, so four characters sitting
// in a row read as four people without introducing four new hues.

export type VoiceAvatarProps = {
  size?: number;
  /** Selected state: the card is filled, so the linework flips to the
   * card's foreground and the accent lifts to something readable on it. */
  inverted?: boolean;
};

const ACCENTS = {
  neighbour: "var(--brand-teal)",
  cook: "var(--brand-coral)",
  night: "var(--brand-purple)",
  family: "var(--brand-gold)",
} as const;

const INVERTED_ACCENTS = {
  neighbour: "rgba(255,255,255,0.9)",
  cook: "#ffc9b4",
  night: "#d8c4f0",
  family: "#ffd894",
} as const;

function frame(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 64 64",
    "aria-hidden": true as const,
    style: { display: "block" as const, flexShrink: 0 },
  };
}

const LINE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The neighbour: a face at a window, because the whole character is
 * someone who watches this street go by every day. */
export function NeighbourAvatar({ size = 44, inverted = false }: VoiceAvatarProps) {
  const accent = inverted ? INVERTED_ACCENTS.neighbour : ACCENTS.neighbour;
  return (
    <svg {...frame(size)}>
      <rect x="8" y="8" width="48" height="48" rx="6" fill={accent} opacity={inverted ? 0.25 : 0.14} />
      <path {...LINE} d="M14 24h36M32 14v10" opacity="0.55" />
      <circle {...LINE} cx="32" cy="36" r="7" />
      <path {...LINE} d="M20 52c2.5-5.5 6.8-8 12-8s9.5 2.5 12 8" />
      <path {...LINE} d="M8 14h48" />
    </svg>
  );
}

/** The cook: a face over a pan, steam rising. */
export function CookAvatar({ size = 44, inverted = false }: VoiceAvatarProps) {
  const accent = inverted ? INVERTED_ACCENTS.cook : ACCENTS.cook;
  return (
    <svg {...frame(size)}>
      <circle cx="32" cy="32" r="24" fill={accent} opacity={inverted ? 0.25 : 0.14} />
      <path {...LINE} d="M24 14c0 3-3 4-3 7M32 12c0 3-3 4-3 7M40 14c0 3-3 4-3 7" opacity="0.6" />
      <circle {...LINE} cx="32" cy="31" r="6" />
      <path {...LINE} d="M16 46h32" />
      <path {...LINE} d="M18 40c1.8 3.5 7 6 14 6s12.2-2.5 14-6" />
      <path {...LINE} d="M48 40h6" />
    </svg>
  );
}

/** Someone up late: a face under a streetlight. */
export function NightAvatar({ size = 44, inverted = false }: VoiceAvatarProps) {
  const accent = inverted ? INVERTED_ACCENTS.night : ACCENTS.night;
  return (
    <svg {...frame(size)}>
      <circle cx="32" cy="32" r="24" fill={accent} opacity={inverted ? 0.25 : 0.14} />
      <circle cx="44" cy="18" r="5" fill={accent} opacity={inverted ? 0.9 : 0.75} />
      <path {...LINE} d="M44 23v9" opacity="0.5" />
      <circle {...LINE} cx="28" cy="33" r="6" />
      <path {...LINE} d="M16 50c2.2-5.2 6.4-7.6 12-7.6S37.8 44.8 40 50" />
      <path {...LINE} d="M10 26l6-4M10 40h5" opacity="0.5" />
    </svg>
  );
}

/** A parent: two heights, one holding the other's hand. */
export function FamilyAvatar({ size = 44, inverted = false }: VoiceAvatarProps) {
  const accent = inverted ? INVERTED_ACCENTS.family : ACCENTS.family;
  return (
    <svg {...frame(size)}>
      <circle cx="32" cy="32" r="24" fill={accent} opacity={inverted ? 0.25 : 0.14} />
      <circle {...LINE} cx="24" cy="24" r="6" />
      <path {...LINE} d="M13 46c1.8-6 5.6-9 11-9s9.2 3 11 9" />
      <circle {...LINE} cx="45" cy="33" r="4" />
      <path {...LINE} d="M38 50c1.2-4 3.6-6 7-6s5.8 2 7 6" />
      <path {...LINE} d="M33 42c2-1.5 4-2 6-1.6" opacity="0.6" />
    </svg>
  );
}

export const VOICE_AVATARS = {
  neighbour: NeighbourAvatar,
  cook: CookAvatar,
  night: NightAvatar,
  family: FamilyAvatar,
} as const;
