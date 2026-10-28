// The catch-up copy check: which posts it looks at, and what it changes.
// No model.
//
// Run: npm run test:blog-proofread

import type { DraftReview } from "./blogDraft";
import { correctedPost, KNOWN_TITLE_FIXES, postsToProofread } from "./blogProofread";
import type { BlogPost } from "./blogQuery";
import { STARTER_POSTS } from "./blogStarter";
import { check, finish, heading, section } from "./testutil";

heading("the catch-up copy check");

const post = (over: Partial<BlogPost>): BlogPost =>
  ({
    id: "p1",
    slug: "the-amsterdam-the-canal-boats-never-reach",
    language: "en",
    status: "published",
    title: "The Amsterdam the canal boats never reach",
    excerpt: "Noord is a ferry ride away.",
    body: "## Across the IJ\n\nNoord are close.",
    coverUrl: "/destinations/amsterdam.jpg",
    coverAlt: "Amsterdam",
    coverCredit: "A, CC BY-SA 4.0, via Wikimedia Commons",
    coverCreditUrl: "https://commons.wikimedia.org/x",
    destinations: ["Amsterdam"],
    sources: [],
    ...over,
  }) as BlogPost;

section("which posts");
{
  const starter = STARTER_POSTS[0];
  const list = postsToProofread([
    post({}),
    post({ id: "d", status: "draft" }),
    post({ id: "s", slug: starter.slug, language: starter.language }),
  ]);
  check("published autopilot posts only, not drafts or starter posts", list.length === 1 && list[0].id === "p1");
}

section("what changes");
{
  const review: DraftReview = { title: "Something else", excerpt: "Noord is a ferry ride away.", body: "## Across the IJ\n\nNoord is close.", publishable: true, issues: [] };
  const fixed = correctedPost(post({}), review);
  check("the Amsterdam headline is put right", fixed?.title === "The side of Amsterdam the canal boats never reach", JSON.stringify(fixed));
  check("the body's grammar is corrected", fixed?.body.includes("Noord is close") === true);
  check("the address stays, so shared links keep working", fixed?.slug === "the-amsterdam-the-canal-boats-never-reach");
  check("the cover and its credit stay", fixed?.coverCredit === post({}).coverCredit);

  const noModel = correctedPost(post({}), null);
  check("the known headline is fixed even with no model", noModel?.title === KNOWN_TITLE_FIXES["The Amsterdam the canal boats never reach"] && noModel.body === post({}).body);
  const doubtful = correctedPost(post({ title: "Fine title" }), { ...review, publishable: false });
  check("an editor in doubt changes nothing", doubtful === null);
  check("nothing to change, nothing saved", correctedPost(post({ title: "Fine title" }), null) === null);
}

finish();
