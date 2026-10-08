// Serves the authored scenes, inside the app's own CSS.
//
// WHY A SERVER AND NOT A FILE. A scene has to be set in Literata and the
// app's interface face, and those fonts are self-hosted by next/font
// under /_next/static/media with @font-face rules in the built
// stylesheet. Open a scene as a file:// document and the type silently
// falls back to whatever the system has, which is the one thing a brand
// film cannot do. So the real stylesheet is inlined with its url()s
// rewritten to absolute addresses on the running Next server, and the
// scene is served over http like any other page.
//
// The <html> class matters too: next/font puts its variables on <html>
// via hashed class names, and globals.css declares --font-body against
// :root. Without the same classes, every font variable resolves to
// nothing and takes the declaration with it - which the root layout has
// a comment about, having been bitten by it. So the class list is read
// off the real homepage rather than guessed.

import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The app's built CSS, with asset URLs pointed at the running server. */
export function appStylesheet(frontend, nextOrigin) {
  const dir = join(frontend, ".next", "static", "css");
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  if (files.length === 0) throw new Error("no built CSS under .next/static/css - run npm run build");
  return files
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .replace(/url\(\//g, `url(${nextOrigin}/`);
}

/** The class list next/font put on <html>, read off the real homepage. */
export async function htmlFontClasses(nextOrigin) {
  const res = await fetch(`${nextOrigin}/`);
  const html = await res.text();
  const match = /<html[^>]*class="([^"]*)"/.exec(html);
  if (!match) throw new Error("could not find the <html> class list on the homepage");
  return match[1];
}

/**
 * Serves each scene at /scene/<name>.
 *
 * Bound to 127.0.0.1 because the recorder resolves nothing else - see
 * the host-resolver rules in scripts/lib/recorder.mjs.
 */
export async function startSceneHost({ scenes, stylesheet, htmlClass }) {
  const bodies = new Map(
    scenes.map((scene) => [
      scene.name,
      `<!doctype html>
<html class="${htmlClass}" lang="en">
<head><meta charset="utf-8"><title>${scene.name}</title>
<style>${stylesheet}</style>
<style>html,body{background:var(--bg-page,#f7f1e2)}</style>
</head>
<body>${scene.html}</body>
</html>`,
    ])
  );

  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? "").replace(/^\/scene\//, "").split("?")[0]);
    const body = bodies.get(name);
    if (!body) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`no scene called ${name}`);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  });

  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });

  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise((done) => {
        server.close(() => done());
      }),
  };
}
