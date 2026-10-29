// Two blog posts a week, written, published and handed over as a ready
// Instagram post, with nobody at the keyboard.
//
// On Mondays and Thursdays the daily report's run (app/api/cron/daily-
// report) also runs this, in a four-post rotation (kindFor): a practical
// travel tip and a "worth the trip" destination piece one week, the
// mistakes visitors make in a city and a true story the next. City pieces
// are about the destination guide city the blog has said least about,
// with the site's own credited photo of it as the cover and a link to its
// guide; a tip gets a Pexels photo when there is a key. All through the
// same writeDraft the editor's "Write draft" button uses. It emails the
// owner the post and its Instagram package (app/admin/instagram).
//
// Before anything is published a second, fast model copy edits it
// (reviewDraft): grammar, spelling, awkward phrasing, the headline. Only a
// post that editor passed goes live by itself; one it doubted, or that it
// could not finish in time, is saved as a draft and the email says it
// needs a look. A published post that still reads wrong can be
// unpublished from /admin/blog the same morning.
//
// Tips and mistakes must rest on sources the model found on the web and
// lists under the post; one that came back without any waits as a draft.
// Never news: a scheduled run cannot judge what is newsworthy this week.
//
// Run: npm run test:blog-autopilot (the choices and the package, no model)

import type Anthropic from "@anthropic-ai/sdk";
import { findCoverPhoto, reviewDraft, SOURCED_KINDS, writeDraftWithReason, type BlogDraft, type CoverPhoto, type DraftKind, type DraftReview } from "./blogDraft";
import { blogSlug, listAllPosts, parseBlogInput, savePost, setPostStatus, type BlogPost } from "./blogQuery";
import { DESTINATION_PHOTO_CREDITS } from "./destinationPhotoCredits";
import { getDestinationPhoto, getLocalizedCityName, listDestinationSlugs, loadDestination } from "./destinations";
import { parseBlocks } from "./miniMarkdown";
import type { Queryable } from "./tripsQuery";

/** Monday and Thursday, in UTC like the cron that runs it. */
export function isAutopilotDay(now: Date): boolean {
  const day = now.getUTCDay();
  return day === 1 || day === 4;
}

export interface AutopilotTopic {
  slug: string;
  city: string;
  kind: DraftKind;
  topic: string;
}

/** Practical subjects for the tip posts, taken in turn. European, because
 * that is who plans with decide. */
export const TIP_THEMES = [
  "carrying liquids through airport security in Europe, and which airports have relaxed the 100 ml rule",
  "low-cost airline cabin bag rules (Ryanair, Wizz Air, easyJet) and how to avoid paying at the gate",
  "claiming compensation for a delayed or cancelled flight under EU rules",
  "the EU Entry/Exit System and ETIAS: what changes at the border and for whom",
  "booking European trains early, rail passes, and when each is the cheaper choice",
  "dynamic currency conversion and card fees abroad: what to press at the card machine",
  "mobile roaming in and outside the EU, and when a local or eSIM plan is worth it",
  "city tourist taxes and entry fees in Europe, and how to budget for them",
];

/** Weeks since 1970 counted from Mondays (1 January 1970 was a
 * Thursday), so a Monday and its Thursday share a number. */
function weekNumber(now: Date): number {
  return Math.floor((Math.floor(now.getTime() / 86_400_000) + 3) / 7);
}

/** The rotation, four posts long, two a week: a tip and a destination
 * piece one week, a mistakes piece and a story the next. */
export function kindFor(now: Date): DraftKind {
  const week = weekNumber(now);
  const thursday = now.getUTCDay() === 4;
  if (week % 2 === 0) return thursday ? "destination" : "tip";
  return thursday ? "story" : "mistakes";
}

/** The guide city the blog has written least about (ties broken by the
 * guide list's own order, so the rotation is predictable), and the piece
 * for the day. */
export function pickTopic(slugs: string[], cities: Record<string, string>, posts: Pick<BlogPost, "destinations">[], now: Date): AutopilotTopic | null {
  if (slugs.length === 0) return null;
  const said = (city: string) =>
    posts.filter((p) => (p.destinations ?? []).some((d) => d.trim().toLowerCase() === city.toLowerCase())).length;
  const slug = [...slugs].sort((a, b) => said(cities[a] ?? a) - said(cities[b] ?? b))[0];
  const city = cities[slug] ?? slug;
  const kind = kindFor(now);
  const week = weekNumber(now);
  const topic =
    kind === "tip"
      ? `A practical tip for travellers in Europe about ${TIP_THEMES[Math.floor(week / 2) % TIP_THEMES.length]}. Confirm it from official sources and say what is current as of today.`
      : kind === "mistakes"
        ? `The mistakes visitors to ${city} most often make, and what to do instead. Confirm any rule, fine or fee from official sources.`
        : kind === "story"
          ? `A fascinating, true story behind a place in ${city} that most visitors walk straight past without knowing. Say clearly what is legend and what is fact.`
          : `${city}: one side of the city most visitors miss, a neighbourhood, walk or easy day trip worth planning a day around, and the best time of year for it.`;
  return { slug, city, kind, topic };
}

/** The post as it will be saved. A city piece gets the guide city's own
 * photo as the cover with the credit its licence asks for, and a line
 * linking to the city's guide if the draft did not already. A tip is not
 * about one city: its cover is the Pexels photo, when there is one. */
export function postFromDraft(draft: BlogDraft, topic: AutopilotTopic, coverSrc: string | null, tipCover: CoverPhoto | null = null) {
  const common = { language: "en", slug: draft.slug, title: draft.title, excerpt: draft.excerpt, sources: draft.sources };
  if (topic.kind === "tip") {
    return {
      ...common,
      body: draft.body,
      coverUrl: tipCover?.url ?? null,
      coverAlt: tipCover ? tipCover.alt || draft.title : null,
      coverCredit: tipCover?.credit ?? null,
      coverCreditUrl: tipCover?.creditUrl ?? null,
      destinations: draft.destinations,
    };
  }
  const guide = `/destinations/${topic.slug}`;
  const body = draft.body.includes(guide)
    ? draft.body
    : `${draft.body.trim()}\n\nPlanning a visit? Our [${topic.city} guide](${guide}) has the essentials, and decide can plan the whole trip in about a minute.`;
  const credit = DESTINATION_PHOTO_CREDITS[topic.slug];
  return {
    ...common,
    body,
    coverUrl: coverSrc,
    coverAlt: coverSrc ? topic.city : null,
    coverCredit: coverSrc && credit ? `${credit.artist}, ${credit.license}, via Wikimedia Commons` : null,
    coverCreditUrl: coverSrc && credit ? credit.sourceUrl : null,
    destinations: draft.destinations.length > 0 ? draft.destinations : [topic.city],
  };
}

export type AutopilotResult =
  | {
      ok: true;
      post: { id: string; slug: string; title: string };
      topic: AutopilotTopic;
      /** "draft" when the copy editor did not pass it: saved, not live. */
      status: "published" | "draft";
      issues: string[];
    }
  | { ok: false; detail: string };

/** The draft with the copy editor's corrections, and whether it may go
 * live unattended. No review (timed out, unusable) means it may not. */
export function applyReview(draft: BlogDraft, review: DraftReview | null): { draft: BlogDraft; publish: boolean; issues: string[] } {
  if (!review) return { draft, publish: false, issues: ["The copy check did not finish, so it was not published."] };
  return {
    draft: { ...draft, title: review.title, slug: blogSlug(review.title), excerpt: review.excerpt || draft.excerpt, body: review.body },
    publish: review.publishable,
    issues: review.issues,
  };
}

/** The whole run fits the function's 180 seconds (a sourced post searches
 * the web first); the copy check gets what the draft left of it. */
const RUN_BUDGET_MS = 170_000;
const REVIEW_MAX_MS = 40_000;
const REVIEW_MIN_MS = 5_000;
/** Enough for a second draft and its copy check. */
const RETRY_MIN_MS = 100_000;

/** Writes, checks, saves and (when the check passed) publishes one post.
 * Never throws. */
export async function runBlogAutopilot(db: Queryable, client: Anthropic, now = new Date()): Promise<AutopilotResult> {
  const deadline = Date.now() + RUN_BUDGET_MS;
  try {
    const slugs = listDestinationSlugs();
    const cities = Object.fromEntries(slugs.map((s) => [s, getLocalizedCityName(s, "en", loadDestination(s)?.city ?? s)]));
    const topic = pickTopic(slugs, cities, await listAllPosts(db), now);
    if (!topic) return { ok: false, detail: "No destination guides to write about." };

    const request = { kind: topic.kind, topic: topic.topic, language: "en" as const, today: now.toISOString().slice(0, 10) };
    let written = await writeDraftWithReason(client, request);
    // One more go when there is time for a whole second draft: a bad
    // reply is usually a one-off.
    if (!written.draft && deadline - Date.now() > RETRY_MIN_MS) written = await writeDraftWithReason(client, request);
    const draft = written.draft;
    if (!draft) return { ok: false, detail: `The ${topic.kind} piece about ${topic.city} could not be used: ${written.problem}.` };

    const left = Math.min(REVIEW_MAX_MS, deadline - Date.now());
    const checked = applyReview(draft, left >= REVIEW_MIN_MS ? await reviewDraft(client, draft, "en", left) : null);
    if (SOURCED_KINDS.has(topic.kind) && draft.sources.length === 0) {
      checked.publish = false;
      checked.issues = [...checked.issues, "It needed sources and came back without any."];
    }

    const tipCover = topic.kind === "tip" ? await findCoverPhoto(draft.imageQuery, process.env.PEXELS_API_KEY) : null;
    const raw = postFromDraft(checked.draft, topic, getDestinationPhoto(topic.slug)?.src ?? null, tipCover);
    // Through the editor's own checks, so an automatic post meets exactly
    // the bar a hand-made one does.
    const parsed = parseBlogInput(raw);
    if (!parsed.ok) return { ok: false, detail: `The draft did not pass the editor's checks: ${parsed.detail}` };

    let saved = await savePost(db, parsed.post);
    if (!saved.ok) {
      // Same address as an older post: a dated one instead.
      saved = await savePost(db, { ...parsed.post, slug: `${parsed.post.slug}-${now.toISOString().slice(0, 10)}`.slice(0, 80) });
    }
    if (!saved.ok) return { ok: false, detail: saved.detail };
    if (checked.publish) await setPostStatus(db, saved.id, "published");
    return {
      ok: true,
      post: { id: saved.id, slug: parsed.post.slug, title: parsed.post.title },
      topic,
      status: checked.publish ? "published" : "draft",
      issues: checked.issues,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}

export interface InstagramSlide {
  kind: "cover" | "point" | "cta";
  title: string;
  text: string;
}

export interface InstagramPackage {
  slides: InstagramSlide[];
  caption: string;
}

const MAX_POINT_SLIDES = 4;

function firstSentence(text: string): string {
  const plain = text
    .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
  const match = /^(.{20,220}?[.!?])(\s|$)/.exec(plain);
  return (match ? match[1] : plain.slice(0, 200)).trim();
}

function hashtag(value: string): string {
  return `#${value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "")}`;
}

/** A carousel and a caption from a published post: the cover, one slide
 * per section (its heading and the first sentence under it), and a
 * closing slide pointing at the full story. The words are the post's own,
 * so nothing on Instagram says more than the article does. */
export function instagramPackage(post: Pick<BlogPost, "title" | "excerpt" | "body" | "destinations">, siteHost = "yourdecide.com"): InstagramPackage {
  const blocks = parseBlocks(post.body);
  const points: InstagramSlide[] = [];
  for (let i = 0; i < blocks.length && points.length < MAX_POINT_SLIDES; i++) {
    const block = blocks[i];
    if (block.kind !== "h2") continue;
    const next = blocks.slice(i + 1).find((b) => b.kind === "p" || b.kind === "ul" || b.kind === "ol");
    const text = !next ? "" : "items" in next ? firstSentence(next.items[0] ?? "") : "text" in next ? firstSentence(next.text) : "";
    if (text) points.push({ kind: "point", title: block.text.replace(/\*\*|\*/g, ""), text });
  }
  const city = post.destinations[0] ?? "";
  const slides: InstagramSlide[] = [
    { kind: "cover", title: post.title, text: city },
    ...points,
    { kind: "cta", title: "Read the full story", text: `Link in bio · ${siteHost}` },
  ];
  const tags = ["#travel", "#traveltips", "#travelinspiration", ...(city ? [hashtag(city), hashtag(`${city}travel`)] : []), "#decidetravel"];
  const caption = [
    post.title,
    "",
    post.excerpt,
    "",
    ...points.map((p) => `→ ${p.title}`),
    ...(points.length > 0 ? [""] : []),
    "The full story is on our blog, link in bio.",
    `Going${city ? ` to ${city}` : ""}? decide plans the whole trip, day by day, in about a minute: ${siteHost}`,
    "",
    tags.join(" "),
  ].join("\n");
  return { slides, caption };
}
