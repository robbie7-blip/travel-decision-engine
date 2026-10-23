// The blog's rules: what a post may be saved with, how its address is
// made, and that an article becomes elements, never markup.
//
// Run: npm run test:blog

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { blogSlug, isAllowedCoverUrl, parseBlogInput } from "./blogQuery";
import { MiniMarkdown, parseBlocks, plainText, readingMinutes } from "./miniMarkdown";
import { parseDraft } from "./blogDraft";
import { blogPath, sizedCover } from "./blogPaths";

// Addresses.
assert.equal(blogSlug("Lisbon's New Night Trams!"), "lisbons-new-night-trams");
assert.equal(blogSlug("Матера: градът в пещерите"), "matera-gradat-v-peshterite", "Cyrillic transliterated");
assert.equal(blogSlug("Zürich \u2014 à la carte"), "zurich-a-la-carte");
assert.ok(blogSlug("x".repeat(200)).length <= 80);
assert.equal(blogPath("en", "a"), "/blog/a");
assert.equal(blogPath("bg"), "/bg/blog");

// Covers: royalty-free libraries or the site's own photos, nothing else.
assert.ok(isAllowedCoverUrl("https://images.pexels.com/photos/1/pexels-photo-1.jpeg"));
assert.ok(isAllowedCoverUrl("https://images.unsplash.com/photo-123"));
assert.ok(isAllowedCoverUrl("/destinations/rome.jpg"));
for (const bad of ["http://images.pexels.com/x.jpg", "https://instagram.com/p/x.jpg", "https://evil.example/pexels.jpg", "/destinations/../x.jpg", "javascript:alert(1)", "https://user@images.pexels.com/x"]) {
  assert.ok(!isAllowedCoverUrl(bad), `refused: ${bad}`);
}
assert.match(sizedCover("https://images.pexels.com/photos/1/p.jpeg", 1200, 630), /w=1200.*h=630.*fit=crop|h=630.*w=1200/);

// Saving.
const ok = parseBlogInput({ language: "en", title: "  Matera  ", body: "Text", destinations: ["Matera", "", "x".repeat(200)], sources: [{ url: "https://a.example/x" }] });
assert.ok(ok.ok);
if (ok.ok) {
  assert.equal(ok.post.slug, "matera");
  assert.deepEqual(ok.post.destinations, ["Matera", "x".repeat(80)], "blank places dropped, long ones cut");
  assert.equal(ok.post.sources[0].title, "a.example", "a source with no title is named by its site");
  assert.equal(ok.post.coverCredit, null, "no cover, no credit");
}
assert.ok(!parseBlogInput({ language: "fr", title: "x" }).ok, "language must be en or bg");
assert.ok(!parseBlogInput({ language: "en", title: "" }).ok, "a title is required");
assert.ok(!parseBlogInput({ language: "en", title: "x", coverUrl: "https://instagram.com/x.jpg" }).ok, "covers from elsewhere are refused");
assert.ok(!parseBlogInput({ language: "en", title: "x", sources: [{ url: "javascript:alert(1)" }] }).ok, "sources must be web addresses");

// The article: elements only.
const html = renderToStaticMarkup(
  <MiniMarkdown
    source={[
      "# Big heading becomes h2",
      "Hello <script>alert(1)</script> **bold** and *it* and [site](https://example.com) and [bad](javascript:alert(1)) and [home](/blog).",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "> a quote",
      "",
      "![A view](https://images.pexels.com/photos/1/p.jpeg)",
      "",
      "![Not allowed](https://evil.example/x.jpg)",
      "",
      "<img src=x onerror=alert(1)>",
    ].join("\n")}
  />
);
assert.ok(html.includes("<h2"), "# is an h2: the page title is the h1");
assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), "markup in the text is shown as text");
assert.ok(!html.includes("<img src=\"x\"") && html.includes("&lt;img src=x"), "raw HTML stays text");
assert.ok(html.includes("<strong>bold</strong>") && html.includes("<em>it</em>"));
assert.ok(html.includes('href="https://example.com/"') && html.includes('rel="noopener noreferrer"'));
assert.ok(!html.includes("javascript:"), "an unsafe link is text only");
assert.ok(html.includes('href="/blog"'), "site links work");
assert.ok(html.includes("<ul") && html.includes("<ol") && html.includes("<blockquote"));
assert.ok(html.includes("images.pexels.com") && !html.includes("evil.example"), "only allowed images");
assert.equal(parseBlocks("a\nb\n\nc").length, 2, "lines join into paragraphs");
assert.equal(plainText("## Hi\n\n**Bold** [x](https://a.b)"), "Hi Bold x");
assert.equal(readingMinutes("word ".repeat(440)), 2);

// Drafts from the model.
const body = "A".repeat(300);
const draft = parseDraft(`Here you go:\n{"title":"Matera \u2014 the cave city","excerpt":"x","body":"${body} \u2014 with a dash","destinations":["Matera"],"sources":[{"title":"t","url":"https://a.b/c"},{"url":"not a url"}],"image_query":"matera italy"}`);
assert.ok(draft);
if (draft) {
  assert.equal(draft.slug, "matera-the-cave-city");
  assert.ok(!draft.body.includes("\u2014"), "dashes removed from the body");
  assert.equal(draft.sources.length, 1, "a source that is not a web address is dropped");
  assert.equal(draft.imageQuery, "matera italy");
}
assert.equal(parseDraft("no json here"), null);
assert.equal(parseDraft('{"title":"x","body":"too short"}'), null, "a stub is not a draft");

console.log("blog: all assertions passed");
