// The house, in one place, because two things draw it now: the Home item
// in the nav row (NavMenu.tsx) and the chip beside the wordmark
// (HomeChip.tsx). A glyph hand-copied into two files is the same drift
// this header has already been bitten by twice.
//
// A roof and a doorway, nothing cleverer about travel: this is the one
// mark in the product whose job is to be recognised rather than read.
// Stroked in currentColor on a 24x24 grid at 1.8, matching the other
// seven nav icons exactly, so it inherits every colour transition its
// container already has instead of carrying a hue of its own.
export function HouseGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      style={{ width: size, height: size, flexShrink: 0 }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      <path d="M9.8 20v-5.2h4.4V20" />
    </svg>
  );
}
