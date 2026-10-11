// Every control a screen reader can reach announces itself as something.
//
// WHY THIS EXISTS. The sign-in field on /account/visited was a copy of
// the one on /account, which carries an aria-label and a comment saying
// why - a placeholder is not a label and is gone the moment you type.
// The copy lost the label. The field looked identical, behaved
// identically, and announced itself as "edit text": the only way to sign
// in on that page, unnamed. Nothing in the diff showed it and nothing in
// the suite caught it, because what is wrong is not in the markup, it is
// in what the markup computes to.
//
// ASKED OF THE ACCESSIBILITY TREE, NOT OF THE DOM. The first version of
// this walked querySelectorAll and immediately reported a file input on
// /ask that is display:none - a hidden proxy clicked by a visible button,
// which a screen reader never sees at all. A DOM sweep cannot tell that
// apart from a real fault, and a check that cries wolf gets switched off.
// Chromium computes the real thing: Accessibility.getFullAXTree returns
// each node's resolved role and name, with everything hidden already
// marked ignored. That is the same computation the screen reader does.
//
// Run: npm run build && npm run check:a11y-names

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findChrome, startNextServer } from "./lib/devServer.mjs";
import { openRecorder, SWIFTSHADER_ARGS } from "./lib/recorder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");

/** The same list checkTouchTargets drives, for the same reason: these are
 * the pages a visitor can reach. The deliberately missing route is here
 * too - the 404 is a page like any other. */
const PAGES = [
  "/",
  "/ask",
  "/pricing",
  "/account",
  "/account/visited",
  "/destinations",
  "/destinations/rome",
  "/showcase",
  "/decide-for-me",
  "/why-decide",
  "/terms",
  "/privacy",
  "/cookies",
  "/compare",
  "/compare-stats",
  "/this-route-does-not-exist",
];

/** Roles whose whole purpose is to be asked for by name.
 *
 * A heading or a paragraph with no accessible name is a non-event. A
 * button with none is a control nobody can ask for, and a textbox with
 * none is a field nobody can fill in on purpose. */
const MUST_BE_NAMED = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "image",
]);

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  fail([
    "No Chrome or Chromium binary found, and this check reads the accessibility",
    "tree out of a real browser.",
    "",
    "Set CHROME_PATH to one, or install Chromium. It is NOT skipped when the",
    "browser is missing: a check that quietly passes when it did not run is",
    "worse than one that does not exist.",
  ]);
}

if (!existsSync(join(FRONTEND, ".next"))) {
  fail(["No .next directory, so there is nothing to serve.", "", "  npm run build && npm run check:a11y-names"]);
}

let stopServer = null;
let recorder = null;
process.on("exit", () => {
  try {
    recorder?.close();
  } catch {
    /* already gone */
  }
  stopServer?.();
});

const started = await startNextServer({ cwd: FRONTEND, probePath: "/" });
stopServer = started.stop;
if (!started.ok) {
  fail([
    `next start never answered on port ${started.port}, so nothing was checked.`,
    "",
    started.log.trim() || "(the server printed nothing)",
  ]);
}

recorder = await openRecorder({ chrome, args: SWIFTSHADER_ARGS });

const problems = [];
let checked = 0;

for (const path of PAGES) {
  const page = await recorder.newPage({ width: 1280, height: 900, stepMs: 40, shootTimeoutMs: 20_000 });
  try {
    await page.load(`${started.port ? `http://127.0.0.1:${started.port}` : ""}${path}`, 2200);
    await page.send("Accessibility.enable", {});
    const { nodes } = await page.send("Accessibility.getFullAXTree", {});

    for (const node of nodes) {
      if (node.ignored) continue;
      const role = node.role?.value;
      if (!MUST_BE_NAMED.has(role)) continue;
      const name = (node.name?.value ?? "").trim();

      // A NAME IS NOT ENOUGH IF IT IS THE PLACEHOLDER. Chromium falls
      // back to the placeholder attribute as a last resort when
      // computing an accessible name, so a field with nothing but a
      // placeholder is "named" as far as the tree is concerned - the
      // sign-in field on /account/visited announced itself as
      // "you@example.com". That is the exact fault app/account/page.tsx
      // has a comment about, and the first version of this check walked
      // straight past it. So the placeholder is fetched and compared:
      // if the name IS the placeholder, the field has no label.
      let described = null;
      const attr = (key) => {
        const attrs = described?.node?.attributes ?? [];
        const i = attrs.indexOf(key);
        return i >= 0 ? attrs[i + 1] : "";
      };
      if (node.backendDOMNodeId !== undefined) {
        try {
          described = await page.send("DOM.describeNode", { backendNodeId: node.backendDOMNodeId });
        } catch {
          described = null;
        }
      }
      const placeholder = attr("placeholder").trim();
      const onlyPlaceholder = Boolean(name) && Boolean(placeholder) && name === placeholder;

      if (name && !onlyPlaceholder) {
        checked++;
        continue;
      }
      checked++;
      // Name the element in a way someone can go and find, rather than
      // by an opaque tree id.
      const n = described?.node;
      const where = n
        ? `<${(n.nodeName ?? "?").toLowerCase()}${attr("type") ? ` type="${attr("type")}"` : ""}` +
          `${attr("class") ? ` class="${attr("class").split(" ").slice(0, 2).join(" ")}"` : ""}` +
          `${placeholder ? ` placeholder="${placeholder}"` : ""}>`
        : `(role ${role})`;
      problems.push(
        onlyPlaceholder
          ? `${path}: ${role} named only by its placeholder ("${name}")  ${where}`
          : `${path}: ${role} with no accessible name  ${where}`
      );
    }
  } catch (error) {
    problems.push(`${path}: could not be audited - ${String(error).slice(0, 120)}`);
  }
  await page.close();
}

recorder.close();
recorder = null;
stopServer?.();
stopServer = null;

if (problems.length > 0) {
  fail([
    "Controls a screen reader cannot ask for by name.",
    "",
    ...problems.map((p) => `  ${p}`),
    "",
    "Give it an aria-label, an aria-labelledby, or visible text inside it.",
    "A placeholder is NOT a label: it is a hint, it is not announced as the",
    "field's name by every reader, and it disappears the moment someone",
    "types. app/account/page.tsx has the pattern and a note explaining it.",
    "",
    "An image that is purely decorative is not a fault here - give it",
    'alt="" and it leaves the accessibility tree entirely, which is the',
    "correct way to say it carries no information.",
  ]);
}

console.log(`Every control announces itself (${checked} named controls across ${PAGES.length} pages).`);
process.exit(0);
