// The blog autopilot's choices and its Instagram package. No model.
//
// Run: npm run test:blog-autopilot

import { applyReview, instagramPackage, isAutopilotDay, pickTopic, postFromDraft } from "./blogAutopilot";
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
  const monday = pickTopic(slugs, cities, posts, new Date("2026-11-02T06:00:00Z"));
  check("Porto, never written about", monday?.slug === "porto", JSON.stringify(monday));
  check("a destination piece on Monday", monday?.kind === "destination" && monday.topic.includes("Porto"));
  const thursday = pickTopic(slugs, cities, posts, new Date("2026-11-05T06:00:00Z"));
  check("a story on Thursday", thursday?.kind === "story");
  check("never news", ![monday?.kind, thursday?.kind].includes("news"));
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
