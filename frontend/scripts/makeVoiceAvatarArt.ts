// Rebuilds components/voiceAvatarArt.ts from the generated source drawings.
//
//   npx tsx scripts/makeVoiceAvatarArt.ts            # check only
//   npx tsx scripts/makeVoiceAvatarArt.ts --write    # rewrite the data block
//
// TypeScript rather than .mjs like the other generators here, because the
// work itself lives in lib/vectorPath.ts so that it can be TESTED. That
// is not tidiness: this script cannot run in this repo's own build
// environment at all. It fetches from the image generator's CDN
// (d8j0ntlcm91z4.cloudfront.net), a host the sandbox network policy
// refuses, so the committed art was produced by the same algorithm
// running somewhere that could reach it and carried in by checksum. With
// the script unrunnable, lib/vectorPath.test.ts is the only thing
// standing between an edit to the normaliser and four silently corrupted
// portraits - so the normaliser had to be importable.
//
// Run with no flag, this compares what the sources normalise to against
// the md5s committed in the data file and exits non-zero on a difference
// without writing anything. That default is deliberate: a silent rewrite
// is exactly the failure mode worth preventing here.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normaliseDrawing } from "../lib/vectorPath";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(HERE, "..", "components", "voiceAvatarArt.ts");

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3KMTyy7LDUZzkmBG3y9gvo0tT7Q/";

/** The four drawings that ship, in the order the data file lists them.
 *
 * The prompt is recorded because it is the only way to ask for the same
 * thing again - a job cannot be re-run - and because the set only hangs
 * together through the words all four shared: one uniform stroke weight,
 * a blank face with no features, and NO COLOUR AT ALL. The colour is
 * applied in the component from the existing palette, which is what lets
 * four voices read as four people without four new hues entering the
 * design, and what lets a portrait invert when its card is selected.
 *
 * An earlier batch asked the generator for the colour instead, passing
 * the palette as a constraint. It ignored it per-image: two voices came
 * back on the same gold disc, three introduced hues that were not in the
 * palette, and the hard white fills meant the linework vanished into a
 * dark background. Hence monochrome, and hence this note. */
const SOURCES = [
  {
    name: "neighbour",
    job: "1cf1dc42-b5c9-4c87-ae35-589ef02feb89",
    file: "hf_20261007_102419_1cf1dc42-b5c9-4c87-ae35-589ef02feb89.svg",
    subject:
      "head and shoulders of a person leaning out of an open window with simple shutters, one hand resting on the sill",
  },
  {
    name: "cook",
    job: "473ee635-dee8-498c-9ac0-90a7c3477db8",
    file: "hf_20261007_102342_473ee635-dee8-498c-9ac0-90a7c3477db8.svg",
    subject:
      "head and shoulders of a cook in an apron, holding a shallow pan level with both hands, a small sprig of herbs in the pan",
  },
  {
    name: "night",
    job: "0103b49a-0412-4b2b-a5cb-7c65611532af",
    file: "hf_20261007_102341_0103b49a-0412-4b2b-a5cb-7c65611532af.svg",
    subject:
      "a stylised owl seen front on, perched on a short branch, two large round eyes, small tufted ears, a crescent moon behind its shoulder",
  },
  {
    name: "family",
    job: "5fe1dfaa-a6e3-41c5-933c-0763bb22a5f0",
    file: "hf_20261007_102340_5fe1dfaa-a6e3-41c5-933c-0763bb22a5f0.svg",
    subject:
      "a tall adult and a small child seen from behind, holding hands, walking away, shoulders and heads only in silhouette outline",
  },
] as const;

/** The style every prompt above ends with. Kept once rather than four
 * times, because the set falling apart is what happens when it drifts.
 * `--prompts` prints the four in full, which is what you want in hand
 * before asking the generator for a fifth voice. */
const SHARED_STYLE =
  "Pure black line art on a plain white background, no other colours, no grey, no gradients, " +
  "no shadow, no texture. One uniform stroke weight throughout, rounded line caps, rounded " +
  "corners. Geometric and calm, generous negative space, subject centred and filling most of " +
  "the square frame, flat with no perspective. No text, no letters, no numbers. Editorial " +
  "pictogram, the style of a well-drawn app icon set.";

const BLOCKED_HINT =
  "This usually means the environment is not allowed to reach the generator's CDN " +
  "rather than that the file is gone - see the note at the top of this file. " +
  "Nothing has been written.";

function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

function promptFor(subject: string): string {
  return `Single-colour line icon: ${subject}. ${SHARED_STYLE}`;
}

async function main(): Promise<void> {
  if (process.argv.includes("--prompts")) {
    for (const source of SOURCES) {
      console.log(`${source.name} (job ${source.job})\n  ${promptFor(source.subject)}\n`);
    }
    return;
  }

  const write = process.argv.includes("--write");
  const existing = await readFile(DATA_FILE, "utf8");

  const built: { name: string; d: string }[] = [];
  for (const source of SOURCES) {
    let response: Response;
    try {
      response = await fetch(CDN + source.file);
    } catch (error) {
      throw new Error(`${source.file}: ${String(error)}. ${BLOCKED_HINT}`);
    }
    // 403 and 407 here are the shape a blocked host takes rather than a
    // missing file: the request never reaches the CDN, the egress proxy
    // answers for it. Worth saying, because "HTTP 403" on its own reads
    // as an expired asset and sends you looking in the wrong place -
    // which is what it did the first time.
    if (response.status === 403 || response.status === 407) {
      throw new Error(`${source.file}: HTTP ${response.status}. ${BLOCKED_HINT}`);
    }
    if (!response.ok) throw new Error(`${source.file}: HTTP ${response.status}`);
    built.push({ name: source.name, d: normaliseDrawing(await response.text()) });
  }

  let differs = 0;
  for (const { name, d } of built) {
    const committed = new RegExp(`md5 ([0-9a-f]{32})\\n  ${name}:`).exec(existing)?.[1];
    const same = committed === md5(d);
    if (!same) differs += 1;
    console.log(
      `${same ? "same" : "DIFFERS"}  ${name.padEnd(10)} ${String(d.length).padStart(5)} chars  ${md5(d)}`
    );
  }

  if (!write) {
    console.log(
      differs === 0
        ? "\nall four match what is committed"
        : `\n${differs} drawing(s) differ from what is committed; re-run with --write to accept`
    );
    process.exit(differs === 0 ? 0 : 1);
  }

  // Only the data block is replaced. The prose in that file explains a
  // design decision rather than describing any byte of output, so it
  // belongs beside the data and not in a string literal here.
  const dataStart = existing.indexOf("export const VOICE_AVATAR_ART");
  const afterData = existing.indexOf("/** The box the paths");
  if (dataStart < 0 || afterData < 0) {
    throw new Error("cannot find the data block - has voiceAvatarArt.ts been restructured?");
  }
  const block = built.map(({ name, d }) => `  // md5 ${md5(d)}\n  ${name}:\n    "${d}",\n`).join("");
  await writeFile(
    DATA_FILE,
    `${existing.slice(0, dataStart)}export const VOICE_AVATAR_ART = {\n${block}} as const;\n\n${existing.slice(afterData)}`
  );
  console.log(`\nwrote ${DATA_FILE}`);
}

void main();
