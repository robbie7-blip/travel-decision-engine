// Generative hero banner for the /destinations guides — there's no photo
// budget (no external network access to fetch real photography), so each
// city gets a distinct-but-on-brand banner instead: one of a handful of
// gradient pairs built entirely from the app's existing palette, plus a
// faint great-circle arc motif that echoes the "one committed route" idea
// behind the logo, rather than a generic stock-photo stand-in.

const PALETTES: [string, string][] = [
  ["#1f6f8a", "#5fc9d9"], // teal — the button/lodging-verified gradient
  ["#d9643f", "#e8a23f"], // terracotta -> gold — the headline gradient
  ["#2b241c", "#4a4136"], // ink -> ink-soft — a moodier night variant
  ["#7d5ba6", "#5fc9d9"], // single-source purple -> teal
  ["#e8a23f", "#d9643f"], // gold -> terracotta, reversed
  ["#1f6f8a", "#7d5ba6"], // teal -> purple
];

function paletteFor(slug: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  return PALETTES[hash % PALETTES.length];
}

export function DestinationBanner({
  city,
  slug,
  compact = false,
}: {
  city: string;
  slug: string;
  compact?: boolean;
}) {
  const [from, to] = paletteFor(slug);
  const gradId = `bannerGrad-${slug}`;
  const height = compact ? 140 : 280;

  return (
    <svg
      viewBox={`0 0 1200 ${height}`}
      width="100%"
      height={compact ? 140 : 280}
      preserveAspectRatio="none"
      style={{ display: "block", borderRadius: compact ? 10 : 14 }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1200" y2={height} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="1200" height={height} fill={`url(#${gradId})`} />
      <path
        d={`M -60 ${height * 0.78} Q 600 ${height * -0.5} 1260 ${height * 0.5}`}
        fill="none"
        stroke="rgba(255,253,248,0.22)"
        strokeWidth={compact ? 1.5 : 2}
      />
      <circle cx={1130} cy={height * 0.3} r={compact ? 4 : 6} fill="rgba(255,253,248,0.55)" />
      {!compact && (
        <text
          x={56}
          y={44}
          style={{ fontFamily: "var(--font-mono), monospace", fontSize: 13, letterSpacing: 3, fill: "rgba(255,253,248,0.75)" }}
        >
          DESTINATION GUIDE
        </text>
      )}
      <text
        x={56}
        y={compact ? height - 32 : height - 52}
        style={{
          fontFamily: "var(--font-display), Georgia, serif",
          fontWeight: 600,
          fontSize: compact ? 32 : 58,
          fill: "#fffdf8",
        }}
      >
        {city}
      </text>
    </svg>
  );
}
