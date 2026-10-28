// The blog autopilot's choices and its Instagram package. No model.
//
// Run: npm run test:blog-autopilot

import { applyReview, instagramPackage, isAutopilotDay, kindFor, pickTopic, postFromDraft, TIP_THEMES } from "./blogAutopilot";
import { parseReview, reviewSystemPrompt } from "./blogDraft";
import { parseBlogInput } from "./blogQuery";
import { STARTER_POSTS } from "./blogStarter";
import { check, finish, heading, section } from "./testutil";

heading("the blog autopilot");

section("Mondays and Thursdays");
{
  check("Monday", isAutopilotDay(new Date("2026-11-02T06:00:00Z")));
  check("Thursday", isAutopilotDay(new Date("2026-11-05T06:00:00Z")));
  check("not Tuesday", !isAutopilotDay(new Date("2026-11-03T06:00:00Z")));
}

section("the city the blog has said least about");
{
  const slugs = ["lisbon", "porto", "rome"];
  const cities = { lisbon: "Lisbon", porto: "Porto", rome: "Rome" };
  const posts = [{ destinations: ["Lisbon"] }, { destinations: ["Rome"] }, { destinations: ["rome"] }];
  // 2026-11-02 is in an even Monday-to-Sunday week since 1970: a rotation start.
  const monday = pickTopic(slugs, cities, posts, new Date("2026-11-02T06:00:00Z"));
  check("Porto, never written about", monday?.slug === "porto", JSON.stringify(monday));
  check("a tip on the first Monday, sourced", monday?.kind === "tip" && /official sources/.test(monday.topic), JSON.stringify(monday));
  const thursday = pickTopic(slugs, cities, posts, new Date("2026-11-05T06:00:00Z"));
  check("a destination piece that Thursday", thursday?.kind === "destination" && thursday.topic.includes("Porto"));
  const nextMonday = pickTopic(slugs, cities, posts, new Date("2026-11-09T06:00:00Z"));
  check("mistakes in a city the next Monday", nextMonday?.kind === "mistakes" && nextMonday.topic.includes("Porto"));
  check("a story the next Thursday", kindFor(new Date("2026-11-12T06:00:00Z")) === "story");
  check("back to a tip after four posts", kindFor(new Date("2026-11-16T06:00:00Z")) === "tip");
  const tips = new Set([0, 2, 4, 6].map((w) => pickTopic(slugs, cities, posts, new Date(Date.parse("2026-11-02T06:00:00Z") + w * 7 * 86_400_000))?.topic));
  check("a different tip each time", tips.size === 4 && TIP_THEMES.length >= 4);
  check("never news", ![0, 1, 2, 3, 4, 5, 6, 7].some((d) => kindFor(new Date(Date.parse("2026-11-02T06:00:00Z") + d * 86_400_000)) === "news"));
  check("no guides, nothing", pickTopic([], {}, [], new Date()) === null);
}

section("the post it saves meets the editor's own bar");
{
  const draft = {
    title: "Porto's other river bank",
    slug: "portos-other-river-bank",
    excerpt: "Vila Nova de Gaia is where the port lodges are, and the best view of Porto.",
    body: "## Across the bridge\n\n" + "Gaia is the other side. ".repeat(20),
    destinations: ["Porto"],
    sources: [],
    imageQuery: "porto",
  };
  const post = postFromDraft(draft, { slug: "porto", city: "Porto", kind: "destination", topic: "t" }, "/destinations/porto.jpg");
  check("links to the city's guide", post.body.includes("](/destinations/porto)"));
  check("the guide's own photo as the cover", post.coverUrl === "/destinations/porto.jpg");
  check("passes the editor's checks", parseBlogInput(post).ok);
  const linked = postFromDraft({ ...draft, body: draft.body + " See [the guide](/destinations/porto)." }, { slug: "porto", city: "Porto", kind: "destination", topic: "t" }, null);
  check("no second link when the draft already has one", linked.body.split("/destinations/porto").length === 2);
}

section("the copy check before anything goes live");
{
  const original = {
    title: "The Amsterdam the canal boats never reach",
    slug: "x",
    excerpt: "Noord is a ferry ride away.",
    body: "## Across the IJ\n\n" + "Noord are a short ferry ride from the station. ".repeat(10) + "\n\n## Where to eat\n\nSee [the guide](/destinations/amsterdam).",
    destinations: ["Amsterdam"],
    sources: [],
    imageQuery: "amsterdam",
  };
  const fixedBody = original.body.replaceAll("Noord are", "Noord is");
  const reply = (over: Record<string, unknown>) =>
    JSON.stringify({ title: "The side of Amsterdam the canal boats never reach", excerpt: original.excerpt, body: fixedBody, publishable: true, issues: ["headline"], ...over });

  const review = parseReview(`Here it is: ${reply({})}`, original);
  check("a clean copy edit is read", review?.publishable === true && review.body.includes("Noord is"), JSON.stringify(review));
  const applied = applyReview(original, review);
  check("its headline and body are used, with a new address", applied.publish && applied.draft.title.startsWith("The side of") && applied.draft.slug.startsWith("the-side-of") && applied.draft.body === fixedBody);

  check("an editor in doubt keeps it a draft", applyReview(original, parseReview(reply({ publishable: false }), original)).publish === false);
  check("no answer keeps it a draft", applyReview(original, null).publish === false && applyReview(original, null).draft === original);
  check("not JSON is no answer", parseReview("sorry", original) === null);
  check("a rewrite, not an edit, is refused", parseReview(reply({ body: fixedBody + " Extra paragraph.".repeat(40) }), original) === null);
  check("a dropped section is refused", parseReview(reply({ body: fixedBody.replace("## Where to eat", "Where to eat") }), original) === null);
  check("a changed link is refused", parseReview(reply({ body: fixedBody.replace("/destinations/amsterdam", "https://example.com/x") }), original) === null);
  const dashed = parseReview(reply({ title: "Amsterdam \u2014 beyond the canals" }), original);
  check("dashes are taken out", dashed !== null && !/[\u2013\u2014]/.test(dashed.title));
  check("the editor is told not to add facts", /add, remove or change any fact/.test(reviewSystemPrompt("en")));
}

section("a tip is not dressed up as a city piece");
{
  const draft = {
    title: "The airport rule most Europeans still get wrong",
    slug: "the-airport-rule",
    excerpt: "Liquids.",
    body: "## The rule\n\n" + "It depends on the scanner. ".repeat(20),
    destinations: [],
    sources: [{ title: "Airport", url: "https://example.com" }],
    imageQuery: "airport security",
  };
  const topic = { slug: "porto", city: "Porto", kind: "tip" as const, topic: "t" };
  const cover = { url: "https://images.pexels.com/photos/1/a.jpeg", alt: "A tray", credit: "Ann on Pexels", creditUrl: "https://www.pexels.com/@ann" };
  const post = postFromDraft(draft, topic, "/destinations/porto.jpg", cover);
  check("no city guide line", !post.body.includes("/destinations/porto"));
  check("the Pexels photo and its photographer, not the city's", post.coverUrl === cover.url && post.coverCredit === "Ann on Pexels");
  check("not filed under the city", post.destinations.length === 0);
  check("its sources kept", post.sources.length === 1);
  check("passes the editor's checks", parseBlogInput(post).ok);
  check("no photo, no cover", postFromDraft(draft, topic, "/destinations/porto.jpg").coverUrl === null);
}

section("the Instagram package, from a real post");
{
  const venice = STARTER_POSTS.find((p) => p.language === "en" && p.slug.includes("venice"))!;
  const pkg = instagramPackage({ ...venice });
  check("a cover first and a closing slide last", pkg.slides[0].kind === "cover" && pkg.slides.at(-1)?.kind === "cta");
  check("one slide per section, at most four", pkg.slides.filter((s) => s.kind === "point").length >= 1 && pkg.slides.length <= 6);
  check("each slide has a heading and a line", pkg.slides.every((s) => s.title.length > 0));
  check("no Markdown left on a slide", pkg.slides.every((s) => !/\*\*|\]\(/.test(s.title + s.text)));
  check("the caption ends with hashtags, the city's included", /#Venice\b/.test(pkg.caption) && pkg.caption.trim().split("\n").at(-1)!.startsWith("#"));
  check("the caption points to the site", pkg.caption.includes("yourdecide.com"));
  check("no dashes in the caption", !/[\u2013\u2014]/.test(pkg.caption));
}

finish();
