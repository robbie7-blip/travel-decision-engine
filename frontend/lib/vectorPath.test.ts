// Tests for the normaliser behind the Ask a Local portraits.
//
// These matter more than the usual unit test, because the script that
// uses this library CANNOT RUN HERE: it fetches from the image
// generator's CDN, a host this environment's network policy refuses. The
// four drawings that ship were produced by the same algorithm running
// somewhere that could reach it, and verified by md5 on the way in. So
// the only thing standing between a future edit to vectorPath.ts and four
// silently corrupted portraits is this file.
//
// It therefore tests against THE EXACT STRINGS THAT SHIP rather than
// against hand-written fixtures. Committed art is already normalised, so
// two properties have to hold of it, and both are strong:
//
//   - parse then emit returns it byte for byte. Any misreading of a
//     command, any dropped or reordered point, any change to how numbers
//     are written, breaks this.
//   - simplifying it again returns it unchanged. This one was NOT true
//     when first asserted, and the failure was the useful kind: writing a
//     path down rounds it, rounding can make a curve flat enough to
//     become a line, and so one simplify pass does not leave a drawing
//     another pass agrees with. The fix was to define the shipped output
//     as the fixed point (stabilise), not to weaken the test.

import {
  AVATAR_POLICY,
  AVATAR_TOLERANCE,
  boundingBox,
  collectDrawing,
  distanceToSegment,
  emitPath,
  normaliseDrawing,
  parsePath,
  pathPoints,
  roundHalfEven,
  simplify,
  stabilise,
} from "./vectorPath";
import { VOICE_AVATAR_ART } from "../components/voiceAvatarArt";
import { check, finish, heading, section } from "./testutil";

/** A generated drawing in miniature: a 2048 backing rectangle, one ink
 * square, one white square inside it, and a grey the policy ignores. */
const FAKE_SVG = `<svg viewBox="0 0 2048 2048">
<path fill="rgb(255,255,255)" d="M 0 0 L 2048 0 L 2048 2048 L 0 2048 L 0 0 z"/>
<path fill="rgb(27,26,23)" d="M 512 512 L 1536 512 L 1536 1536 L 512 1536 L 512 512 z"/>
<path fill="rgb(255,255,255)" d="M 768 768 L 1280 768 L 1280 1280 L 768 1280 L 768 768 z"/>
<path fill="rgb(131,131,135)" d="M 900 900 L 1000 900 L 1000 1000 L 900 1000 L 900 900 z"/>
</svg>`;

function main(): void {
  heading("vectorPath");

  section("roundHalfEven matches the rounding that produced the committed art");
  {
    check("0.5 goes to 0", roundHalfEven(0.5) === 0, `got ${roundHalfEven(0.5)}`);
    check("1.5 goes to 2", roundHalfEven(1.5) === 2, `got ${roundHalfEven(1.5)}`);
    check("2.5 goes to 2", roundHalfEven(2.5) === 2, `got ${roundHalfEven(2.5)}`);
    check("3.5 goes to 4", roundHalfEven(3.5) === 4, `got ${roundHalfEven(3.5)}`);
    // The whole reason this function exists rather than Math.round.
    check("differs from Math.round on a half", roundHalfEven(2.5) !== Math.round(2.5));
    check("0.4 rounds down", roundHalfEven(0.4) === 0);
    check("0.6 rounds up", roundHalfEven(0.6) === 1);
    check("-1.5 goes to -2", roundHalfEven(-1.5) === -2, `got ${roundHalfEven(-1.5)}`);
    check("-2.5 goes to -2", roundHalfEven(-2.5) === -2, `got ${roundHalfEven(-2.5)}`);
    check("whole numbers are unchanged", roundHalfEven(7) === 7);
  }

  section("distanceToSegment measures to the segment, not its infinite line");
  {
    check("on the chord is zero", distanceToSegment([5, 0], [0, 0], [10, 0]) === 0);
    check("beside the chord", distanceToSegment([5, 3], [0, 0], [10, 0]) === 3);
    // A control point that sits ON the line through a and b but far past
    // b is NOT close to the segment. Measuring to the line would flatten
    // a curve that bulges well outside its own chord.
    check(
      "past the end is far, though it is on the line",
      distanceToSegment([30, 0], [0, 0], [10, 0]) === 20
    );
    check("a degenerate segment is a point", distanceToSegment([3, 4], [0, 0], [0, 0]) === 5);
  }

  section("parsePath splits commands that carry several operations");
  {
    // One "C" with six points is two curves, which is how the generator
    // writes them. Read as one operation, every other curve in the file
    // would be lost.
    const two = parsePath("M0 0C1 1 2 2 3 3 4 4 5 5 6 6");
    check("one M and two Cs", two.length === 3, `got ${two.length}`);
    check("both are curves", two[1].cmd === "C" && two[2].cmd === "C");
    check("three points each", two[1].pts.length === 3 && two[2].pts.length === 3);
    check("second curve starts where the numbers do", two[2].pts[0][0] === 4);

    const closed = parsePath("M0 0L5 0z");
    check("the closepath survives", closed[closed.length - 1].cmd === "z");
    check("it carries no points", closed[closed.length - 1].pts.length === 0);

    const negative = parsePath("M-4 0L-4-8");
    check("negatives parse", negative[1].pts[0][0] === -4 && negative[1].pts[0][1] === -8);
  }

  section("pathPoints and boundingBox");
  {
    check("every pair, control points included", pathPoints("M0 0C1 2 3 4 5 6").length === 4);
    const box = boundingBox(pathPoints("M0 10L20 0L5 30"));
    check("box is min and max on each axis", box.join(",") === "0,0,20,30", box.join(","));
    let threw = false;
    try {
      boundingBox([]);
    } catch {
      threw = true;
    }
    check("the box of nothing throws rather than returning Infinity", threw);
  }

  section("emitPath writes the compact form");
  {
    const out = emitPath(parsePath("M 0 0 L 10 0 L 10 10 z"));
    check("no space before a command", out === "M0 0L10 0L10 10z", out);
    check("coordinates stay whole", !/\./.test(emitPath(parsePath("M0.4 0.6L9.5 2.5"))));
    check("and are rounded half to even", emitPath(parsePath("M0.5 1.5L2.5 3.5")) === "M0 2L2 4");
  }

  section("simplify drops only what cannot be seen");
  {
    // A cubic whose controls sit on its chord is a line drawn the long way.
    const straight = simplify(parsePath("M0 0C3 0 7 0 10 0"));
    check("a flat curve becomes a line", straight[1].cmd === "L");
    check("and keeps its endpoint", straight[1].pts[0][0] === 10);

    // One that bulges does not.
    const curved = simplify(parsePath("M0 0C3 9 7 9 10 0"));
    check("a real curve is left alone", curved[1].cmd === "C");

    // Three points in a row become two, which is most of the saving.
    const collinear = simplify(parsePath("M0 0L5 0L10 0"));
    check("a collinear midpoint goes", collinear.length === 2, `got ${collinear.length}`);
    check("the run ends where it ended", collinear[1].pts[0][0] === 10);

    // A corner is not a midpoint.
    const corner = simplify(parsePath("M0 0L5 0L5 10"));
    check("a corner survives", corner.length === 3, `got ${corner.length}`);
  }

  section("stabilise reaches a fixed point and says so when it cannot");
  {
    // Already lines, and a real corner between them, so there is nothing
    // left for a pass to find.
    const settled = "M0 0L10 0L10 10z";
    check("settled input comes back identical", stabilise(settled) === settled, stabilise(settled));
    // The property that matters, on input that is NOT settled: the flat
    // curve here becomes a line, and the result must then be final.
    const unsettled = "M0 0C3 0 7 0 10 0L10 10z";
    const fixed = stabilise(unsettled);
    check("an unsettled path is changed", fixed !== unsettled, fixed);
    check("and what comes back is final", stabilise(fixed) === fixed, fixed);
    // The guard that matters: a cap, so a drawing that oscillates fails
    // the build rather than hanging it. Zero passes cannot settle
    // anything, which is the cheapest way to reach that branch.
    //
    // The MESSAGE is asserted, not just that something was thrown. The
    // first version of this check named a variable that did not exist, so
    // it passed on the ReferenceError and proved nothing - which is what
    // any bare `catch { threw = true }` is one typo away from.
    let message = "";
    try {
      stabilise(unsettled, AVATAR_TOLERANCE, 0);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    check("it throws rather than looping forever", /did not settle in 0 passes/.test(message), message);
  }

  section("collectDrawing separates linework from knockouts");
  {
    const { ink, holes } = collectDrawing(FAKE_SVG);
    check("one ink path", ink.length === 1, `got ${ink.length}`);
    // The backing rectangle is the one path that MUST be dropped: under
    // evenodd it would invert the whole drawing.
    check("the backing rectangle is dropped", holes.length === 1, `got ${holes.length}`);
    check("the knockout kept is the inner one", holes[0].includes("768"));
    const inkHasNoGrey = !ink.some((d) => d.includes("900"));
    check("the off-palette grey is ignored entirely", inkHasNoGrey && holes.length === 1);
  }

  section("normaliseDrawing frames to the linework");
  {
    // Compared against the same drawing with the knockout removed, which
    // is the only way to see the frame the ink alone would have got. The
    // joined output cannot be split back into paths on whitespace: a
    // coordinate pair has a space in it too.
    const inkOnly = FAKE_SVG.split("\n")
      .filter((line) => !line.includes("768"))
      .join("\n");
    const bare = boundingBox(pathPoints(normaliseDrawing(inkOnly)));
    const d = normaliseDrawing(FAKE_SVG);
    const [x0, y0, x1, y1] = boundingBox(pathPoints(d));
    // The ink square was 1024 of 2048 wide; it should come out at
    // policy.inner, centred in policy.box.
    check(
      "the linework fills `inner`",
      Math.abs(bare[2] - bare[0] - AVATAR_POLICY.inner) <= 1,
      `${bare[2] - bare[0]}`
    );
    check(
      "and is centred",
      Math.abs((bare[0] + bare[2]) / 2 - AVATAR_POLICY.box / 2) <= 1,
      `${(bare[0] + bare[2]) / 2}`
    );
    // The knockout was inside the ink, so adding it back must not move
    // the frame - proof the hole is not dragging the drawing smaller.
    check("the knockout did not change the frame", x0 === bare[0] && x1 === bare[2]);
    check("nothing escapes the box", x0 >= 0 && y0 >= 0 && x1 <= AVATAR_POLICY.box && y1 <= AVATAR_POLICY.box);
    check("the hole is in the output", d.length > normaliseDrawing(inkOnly).length);

    let threw = false;
    try {
      normaliseDrawing('<svg><path fill="rgb(1,2,3)" d="M0 0L1 1"/></svg>');
    } catch {
      threw = true;
    }
    check("a drawing with no ink throws rather than shipping blank", threw);
  }

  section("the committed portraits survive a round trip");
  {
    for (const [name, d] of Object.entries(VOICE_AVATAR_ART)) {
      // Byte for byte. Any misread command, dropped point, reordering or
      // change in how a number is written shows up here.
      check(`${name}: parse then emit is unchanged`, emitPath(parsePath(d)) === d);
      // A fixed point of the simplifier, so running the regeneration
      // script twice cannot quietly shave shape off the art.
      check(`${name}: simplifying again changes nothing`, emitPath(simplify(parsePath(d))) === d);
      check(`${name}: and is already stable`, stabilise(d) === d);
      const [x0, y0, x1, y1] = boundingBox(pathPoints(d));
      check(
        `${name}: stays inside the view box`,
        x0 >= 0 && y0 >= 0 && x1 <= AVATAR_POLICY.box && y1 <= AVATAR_POLICY.box,
        `${x0},${y0},${x1},${y1}`
      );
      // Four portraits in a row at four different scales read as a bug.
      // The normaliser frames each to `inner`, so the largest dimension
      // of each should land there.
      check(
        `${name}: framed to the same size as the others`,
        Math.abs(Math.max(x1 - x0, y1 - y0) - AVATAR_POLICY.inner) <= 2,
        `${Math.max(x1 - x0, y1 - y0)}`
      );
      // evenodd only makes holes where a subpath is closed; an unclosed
      // knockout paints instead of carving.
      check(`${name}: every subpath is closed`, (d.match(/M/g) ?? []).length === (d.match(/z/g) ?? []).length);
    }
  }

  finish();
}

main();
