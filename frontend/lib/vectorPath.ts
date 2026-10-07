// Turning a generated vector drawing into one themeable path.
//
// This exists for the Ask a Local portraits (components/voiceAvatarArt.ts,
// written by scripts/makeVoiceAvatarArt.ts), and it is a library rather
// than lines inside that script for one reason: the script cannot run
// here. It fetches from the image generator's CDN, a host this build
// environment's network policy refuses, so the committed art was produced
// elsewhere and the script can only ever be CHECKED against it. The parts
// that do the actual work therefore have to be testable without a
// network, which is what vectorPath.test.ts does - against the exact four
// strings that ship.
//
// WHAT THE GENERATOR GIVES US. recraft's vector mode returns a stack of
// filled paths: dark ribbons for the linework, white shapes laid over
// them to carve the insides out, and a full-canvas white rectangle
// underneath. Rendered as-is that is an opaque picture - the white is
// paint, not absence - so it cannot sit on a tinted disc and it cannot
// invert for dark mode. Merged into ONE path drawn fill-rule="evenodd"
// the white shapes become real holes, and the drawing becomes line art
// that takes its colour from currentColor.

/** A path command and its points. Only the absolute forms the generator
 * emits: M, L, C and the closepath. */
export type PathSegment = {
  cmd: "M" | "L" | "C" | "Z" | "z";
  pts: [number, number][];
};

const POINTS_PER_COMMAND: Record<PathSegment["cmd"], number> = {
  M: 1,
  L: 1,
  C: 3,
  Z: 0,
  z: 0,
};

const NUMBERS = /-?\d+\.?\d*/g;
const TOKENS = /([MLCZz])|(-?\d+\.?\d*)/g;

/** Round half to EVEN, which is what Python's round() does and what
 * produced the committed art. Math.round takes halves upward, so it would
 * disagree on any coordinate landing exactly on .5 and make the
 * regeneration script report a difference that is not one. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Every coordinate pair in a path string.
 *
 * Works because the generator only emits absolute M, L, C and z, and
 * every argument of those is a point - so the numbers pair up without
 * having to know which command they belong to. Used for bounding boxes,
 * where a CONTROL point counts on purpose: the box of a curve's control
 * polygon contains the box of the curve, so framing to it makes a
 * drawing at worst a shade smaller than it could be, never clipped. */
export function pathPoints(d: string): [number, number][] {
  const nums = (d.match(NUMBERS) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

export function boundingBox(points: [number, number][]): [number, number, number, number] {
  if (points.length === 0) throw new Error("bounding box of nothing");
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** One segment per drawing operation.
 *
 * A single command letter can carry several of them - "C a b c d e f" is
 * two curves, and the generator writes them that way - so the arguments
 * are chunked by how many points the command takes rather than assumed to
 * be one operation. */
export function parsePath(d: string): PathSegment[] {
  const out: PathSegment[] = [];
  let cmd: PathSegment["cmd"] | null = null;
  let nums: number[] = [];

  const flush = () => {
    if (cmd === null) return;
    const takes = POINTS_PER_COMMAND[cmd];
    if (takes === 0) {
      out.push({ cmd, pts: [] });
      return;
    }
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    for (let i = 0; i < pts.length; i += takes) out.push({ cmd, pts: pts.slice(i, i + takes) });
  };

  for (const match of d.matchAll(TOKENS)) {
    if (match[1]) {
      flush();
      cmd = match[1] as PathSegment["cmd"];
      nums = [];
    } else {
      nums.push(Number(match[2]));
    }
  }
  flush();
  return out;
}

/** Distance from a point to the SEGMENT ab - not to the infinite line
 * through it. A bezier control point sitting past either end is far from
 * the chord even when it lies on that line, and flattening a curve on
 * the strength of the line test would move it. */
export function distanceToSegment(
  [px, py]: [number, number],
  [ax, ay]: [number, number],
  [bx, by]: [number, number]
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export type SimplifyTolerance = {
  /** A cubic whose control points both sit within this of the straight
   * chord becomes a line. */
  flat: number;
  /** Three points this close to collinear become two. */
  collinear: number;
};

/** The default tolerances, in units of the 256 grid the portraits are
 * drawn on. 0.7 is about a quarter of a pixel at the largest size these
 * render at, and the simplified drawing was compared against the
 * unsimplified one at 96px and 44px with no visible difference - while
 * being roughly half the data. */
export const AVATAR_TOLERANCE: SimplifyTolerance = { flat: 0.7, collinear: 0.6 };

/** Drops detail the output cannot show.
 *
 * The vectorizer emits a cubic for everything, including segments that
 * are straight, and emits a point wherever it sampled rather than where
 * the drawing turns. Both are invisible at an avatar's size and both cost
 * bytes in a file that ships to every visitor.
 *
 * NOT idempotent on its own, which was worth finding out rather than
 * assuming - a test asserting it was failed. The reason is rounding, not
 * the tolerance eroding its own output: emitPath writes whole numbers, so
 * a curve whose control points sat 0.8 off its chord can land at 0.6 off
 * once written down, and the next read flattens it. Measured across the
 * four portraits, a second pass turns 2 or 3 more curves of about 150
 * into lines and then nothing changes again.
 *
 * So the output that SHIPS is the fixed point, not this function's first
 * answer: see stabilise, which is what normaliseDrawing returns. That
 * makes the committed art stable under re-running, which is the property
 * the test actually needs. */
export function simplify(
  segments: PathSegment[],
  tolerance: SimplifyTolerance = AVATAR_TOLERANCE
): PathSegment[] {
  const flattened: PathSegment[] = [];
  let cursor: [number, number] | null = null;

  for (const segment of segments) {
    if (segment.cmd === "M") {
      cursor = segment.pts[0];
      flattened.push({ cmd: "M", pts: [segment.pts[0]] });
      continue;
    }
    if (segment.cmd === "Z" || segment.cmd === "z") {
      flattened.push({ cmd: segment.cmd, pts: [] });
      continue;
    }
    if (segment.cmd === "C") {
      const [control1, control2, end] = segment.pts;
      const straight =
        cursor !== null &&
        distanceToSegment(control1, cursor, end) <= tolerance.flat &&
        distanceToSegment(control2, cursor, end) <= tolerance.flat;
      flattened.push(straight ? { cmd: "L", pts: [end] } : { cmd: "C", pts: segment.pts });
      cursor = end;
      continue;
    }
    flattened.push({ cmd: "L", pts: [segment.pts[0]] });
    cursor = segment.pts[0];
  }

  const merged: PathSegment[] = [];
  for (const segment of flattened) {
    const previous = merged[merged.length - 1];
    const before = merged[merged.length - 2];
    if (
      segment.cmd === "L" &&
      previous?.cmd === "L" &&
      (before?.cmd === "M" || before?.cmd === "L") &&
      distanceToSegment(previous.pts[0], before.pts[0], segment.pts[0]) <= tolerance.collinear
    ) {
      merged[merged.length - 1] = { cmd: "L", pts: [segment.pts[0]] };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

/** Segments back to a path string, at whole-number precision.
 *
 * The space between a number and the command letter that follows it
 * carries no meaning and is about a tenth of the file, so it goes. */
export function emitPath(segments: PathSegment[]): string {
  return segments
    .map((segment) =>
      segment.cmd === "Z" || segment.cmd === "z"
        ? "z"
        : segment.cmd +
          segment.pts.map(([x, y]) => `${roundHalfEven(x)} ${roundHalfEven(y)}`).join(" ")
    )
    .join("")
    .replace(/(?<=[\dz]) (?=[MLCz])/g, "");
}

/** Simplify, write down, read back, repeat until the string stops
 * changing.
 *
 * Writing a path down rounds it, and rounding can make a curve flat
 * enough to be a line that was not flat enough a moment ago - so one
 * pass of simplify does not leave the drawing in a state that another
 * pass would agree with. Taking the fixed point instead means the
 * committed art is exactly what the pipeline produces no matter how many
 * times it is run, which is the property that makes the round-trip test
 * in vectorPath.test.ts a meaningful guard rather than a tautology.
 *
 * Reached in two iterations for all four portraits. The cap is there so
 * that a drawing which somehow oscillates fails loudly instead of
 * hanging a build. */
export function stabilise(
  d: string,
  tolerance: SimplifyTolerance = AVATAR_TOLERANCE,
  maxPasses = 8
): string {
  let current = d;
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = emitPath(simplify(parsePath(current), tolerance));
    if (next === current) return current;
    current = next;
  }
  throw new Error(`path did not settle in ${maxPasses} passes`);
}

export type DrawingPolicy = {
  /** The fill the generator uses for linework. An exact string: a near
   * match is a different colour, and the greys recraft sometimes adds are
   * shading nobody asked for. */
  ink: string;
  /** The fill it uses to carve insides out. */
  knockout: string;
  /** The generator's coordinate grid, used to recognise the backing
   * rectangle. */
  sourceGrid: number;
  /** The grid the output is drawn on. */
  box: number;
  /** How much of that grid the drawing fills. */
  inner: number;
  tolerance: SimplifyTolerance;
};

export const AVATAR_POLICY: DrawingPolicy = {
  ink: "rgb(27,26,23)",
  knockout: "rgb(255,255,255)",
  sourceGrid: 2048,
  box: 256,
  // 150 of 256 keeps the drawing inside the r=110 tinted disc it sits on
  // with a little air. Measured at 42/64 on the first attempt, where the
  // window burst out of its disc and read as a mistake.
  inner: 150,
  tolerance: AVATAR_TOLERANCE,
};

/** The linework and the knockouts, in document order, with the backing
 * rectangle discarded.
 *
 * That rectangle is the one thing here that MUST go. It covers the whole
 * canvas, so under evenodd it would invert the entire drawing: every hole
 * becomes paint and every line becomes a hole. It is recognised by
 * covering the grid rather than by its exact path string, because the
 * generator has written that string more than one way. */
export function collectDrawing(
  svg: string,
  policy: DrawingPolicy = AVATAR_POLICY
): { ink: string[]; holes: string[] } {
  const ink: string[] = [];
  const holes: string[] = [];
  for (const match of svg.matchAll(/<path([^>]*?)\/?>/g)) {
    const attrs = match[1];
    const fill = /fill="([^"]*)"/.exec(attrs)?.[1];
    const d = /\sd="([^"]*)"/.exec(attrs)?.[1];
    if (!fill || !d) continue;
    if (fill === policy.ink) {
      ink.push(d);
      continue;
    }
    if (fill !== policy.knockout) continue;
    const [x0, y0, x1, y1] = boundingBox(pathPoints(d));
    const coversCanvas =
      x0 <= 0.5 &&
      y0 <= 0.5 &&
      x1 >= policy.sourceGrid - 0.5 &&
      y1 >= policy.sourceGrid - 0.5;
    if (coversCanvas) continue;
    holes.push(d);
  }
  return { ink, holes };
}

/** One generated SVG to one path string, framed, simplified and ready to
 * render with fill-rule="evenodd".
 *
 * Framed on the LINEWORK only. A knockout can extend past the ink it
 * carves - the generator pads them - and letting one into the box would
 * shrink the drawing to fit a shape that is not visible. Scaling to each
 * drawing's own box is not a nicety either: the model frames every
 * subject differently, and four portraits at four scales sitting in a row
 * read as a bug rather than a style.
 *
 * The drawings are concatenated with NOTHING between them, not a space.
 * A command letter delimits itself, so the separator was three bytes of
 * nothing per drawing - and worse, it made the output non-canonical:
 * re-emitting it stripped the space, so a round trip was not the identity
 * and the test that proves this file reads its own output correctly could
 * not be written as one. */
export function normaliseDrawing(svg: string, policy: DrawingPolicy = AVATAR_POLICY): string {
  const { ink, holes } = collectDrawing(
    svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, ""),
    policy
  );
  if (ink.length === 0) {
    throw new Error(`no paths filled ${policy.ink} - the generator's palette changed`);
  }
  const [x0, y0, x1, y1] = boundingBox(ink.flatMap((d) => pathPoints(d)));
  const scale = policy.inner / Math.max(x1 - x0, y1 - y0);
  const dx = (policy.box - (x1 - x0) * scale) / 2 - x0 * scale;
  const dy = (policy.box - (y1 - y0) * scale) / 2 - y0 * scale;
  return stabilise(
    [...ink, ...holes]
      .map((d) =>
        emitPath(
          simplify(
            parsePath(d).map(({ cmd, pts }) => ({
              cmd,
              pts: pts.map(([x, y]) => [x * scale + dx, y * scale + dy] as [number, number]),
            })),
            policy.tolerance
          )
        )
      )
      .join(""),
    policy.tolerance
  );
}
