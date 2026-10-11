// Placeholders shaped like the thing that is coming.
//
// WHAT THIS REPLACES. The account panel rendered the three characters
// "..." in 13px dim grey while it waited for /api/account. That is not a
// loading state, it is a shrug: it does not say how much is coming, it
// does not hold the space the answer will need, and when the answer
// arrives the panel jumps from one line to five.
//
// WHY SHAPES AND NOT A SPINNER. A spinner says "wait" and nothing else.
// A skeleton in the shape of the real content says what is coming and
// reserves the room for it, so the arrival is a fill rather than a jump.
// The product already owns the other half of this idea - the generation
// wait has ThinkingMark, because there the question is "is it still
// working", not "what will be here".
//
// REDUCED MOTION IS HANDLED IN CSS, not here: the shimmer is a keyframe
// animation on .skeleton, and app/globals.css turns it off under
// prefers-reduced-motion while leaving the shapes in place. The shapes
// are the information; the shimmer only says it is not frozen.
//
// ARIA. The group is aria-hidden and carries aria-busy on a live region
// instead, so a screen reader is told "loading" once rather than being
// walked through a dozen meaningless empty boxes.

export function SkeletonLine({
  width = "100%",
  height = 12,
  radius = 6,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
}) {
  return (
    <span
      className="skeleton"
      style={{
        display: "block",
        width: typeof width === "number" ? `${width}px` : width,
        height,
        borderRadius: radius,
      }}
    />
  );
}

export function SkeletonCircle({ size = 44 }: { size?: number }) {
  return (
    <span
      className="skeleton"
      style={{ display: "block", width: size, height: size, borderRadius: "50%", flexShrink: 0 }}
    />
  );
}

/**
 * Wraps a set of placeholders and announces the wait once.
 *
 * `label` is what a screen reader hears - it should name what is being
 * waited for ("Loading your account"), not the fact that boxes exist.
 */
export function SkeletonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}
