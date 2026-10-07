// The "it is working on it" indicator for the two places where you ask the
// product a question and wait: Ask a Local, and pushback on a trip.
//
// Both showed a single grey word and nothing else. A full trip generation
// has had a designed wait for a long time - LoadingScreen's spinner, the
// rotating status line, a rotating fact about the city - but the two
// conversational flows, the ones where you have just typed something and
// are waiting to be answered, had no motion at all. Reported as "you can't
// really see what's going on when you ask it something", which is exactly
// right: nothing on the page changed between pressing send and the answer
// arriving.
//
// IT IS THE LOGO, not a row of dots. The mark is three strokes converging
// on one dot - three questions and one answer, which is the whole product -
// so the wait animates that: a pulse travels down each stroke in turn and
// the dot lights as it arrives. A generic three-dot bounce would have been
// quicker and would have said nothing.
//
// EACH STROKE IS DRAWN TWICE, and that is the part worth reading. The
// first version animated the strokes themselves, with a short dash
// travelling along each one - which meant that for most of the cycle the
// only thing on screen was three disconnected fragments drifting about.
// Rendered frame by frame it did not read as a logo thinking, it read as a
// broken image. So the mark is now always fully drawn, faintly, and the
// pulse is a second copy of each stroke running over the top of it. The
// identity stays legible for the whole cycle, which is the entire point of
// using the logo rather than dots.
//
// Drawn here rather than loaded from public/logo-icon.svg because that file
// uses gradients behind ids, and two of these on a page would be two
// elements claiming the same ids. The colours are the ones those gradients
// run between.

export type ThinkingMarkProps = {
  size?: number;
};

/** The geometry of public/logo-icon.svg, in its own 100-unit coordinates so
 * the two can be compared by eye without arithmetic - but cropped to what
 * is actually drawn.
 *
 * The logo's box is mostly empty: the strokes span x 16 to 84 and the whole
 * mark y 6 to 91, so rendering the full 0-100 box at 22px wasted a third of
 * the width and left three hairlines nobody could see move. Cropping to the
 * content is worth about 30% more mark for the same `size`. */
const VIEW_BOX = "13 4 74 92";

/** Thicker than the logo's 3.5, because this renders at a fifth of the size
 * the logo does and a stroke under a pixel wide cannot show anything
 * travelling along it. */
const STROKE_WIDTH = 7;

/** The three strokes, outer ones first so the middle - the emphasis in the
 * mark itself - draws over them. The pulse runs in this order too. */
const STROKES = [
  { d: "M18 15 Q 34 40 50 72", stroke: "var(--brand-gold)", width: STROKE_WIDTH },
  { d: "M82 15 Q 66 40 50 72", stroke: "var(--brand-gold)", width: STROKE_WIDTH },
  { d: "M50 10 L 50 72", stroke: "var(--brand-teal)", width: STROKE_WIDTH + 1.5 },
] as const;

export function ThinkingMark({ size = 22 }: ThinkingMarkProps) {
  return (
    <svg
      className="thinking-mark"
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      aria-hidden
      focusable="false"
    >
      {/* The mark, always there. Faint, so the pulse has something to be
          brighter than. */}
      {STROKES.map((stroke, i) => (
        <path
          key={`track-${i}`}
          className="thinking-mark-track"
          d={stroke.d}
          fill="none"
          stroke={stroke.stroke}
          strokeWidth={stroke.width}
          strokeLinecap="round"
        />
      ))}
      {/* And the pulse, over the top. Numbered classes rather than
          nth-of-type: there are six paths here, so counting them is the
          kind of thing that silently retargets the moment one is added. */}
      {STROKES.map((stroke, i) => (
        <path
          key={`pulse-${i}`}
          className={`thinking-mark-pulse thinking-mark-pulse-${i + 1}`}
          d={stroke.d}
          fill="none"
          stroke={stroke.stroke}
          strokeWidth={stroke.width}
          strokeLinecap="round"
        />
      ))}
      <circle className="thinking-mark-dot" cx="50" cy="80" r="9" fill="var(--brand-coral)" />
    </svg>
  );
}
