// Two blog posts a week, written, published and handed over as a ready
// Instagram post, with nobody at the keyboard.
//
// On Mondays and Thursdays the daily report's run (app/api/cron/daily-
// report) also runs this. It picks the destination guide city the blog
// has said least about, asks Claude for a piece about it (a "worth the
// trip" piece on Mondays, a true story on Thursdays) through the same
// writeDraft the editor's "Write draft" button uses, gives it the site's
// own credited photo of that city as its cover and a link to the city's
// guide, publishes it, and emails the owner the post and its Instagram
// package (app/admin/instagram).
//
// Published straight away rather than left as a draft, because that is
// what was asked for; the email exists so a post that reads wrong can be
// unpublished from /admin/blog the same morning. Only destination and
// story pieces, never news: news needs fresh sources, which a scheduled
// run cannot check, and the guide cities are the ones the site already
// knows about.
//
// Run: npm run test:blog-autopilot (the choices and the package, no model)

import type Anthropic from "@anthropic-ai/sdk";
import { writeDraft, type BlogDraft, type DraftKind } from "./blogDraft";
import { listAllPosts, parseBlogInput, savePost, setPostStatus, type BlogPost } from "./blogQuery";
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

/** The guide city the blog has written least about (ties broken by the
 * guide list's own order, so the rotation is predictable), and the kind
 * of piece for the day. */
export function pickTopic(slugs: string[], cities: Record<string, string>, posts: Pick<BlogPost, "destinations">[], now: Date): AutopilotTopic | null {
  if (slugs.length === 0) return null;
  const said = (city: string) =>
    posts.filter((p) => (p.destinations ?? []).some((d) => d.trim().toLowerCase() === city.toLowerCase())).length;
  const slug = [...slugs].sort((a, b) => said(cities[a] ?? a) - said(cities[b] ?? b))[0];
  const city = cities[slug] ?? slug;
  const kind: DraftKind = now.getUTCDay() === 4 ? "story" : "destination";
  const topic =
    kind === "story"
      ? `A fascinating, true story behind a place in ${city} that most visitors walk straight past without knowing. Say clearly what is legend and what is fact.`
      : `${city}: one side of the city most visitors miss, a neighbourhood, walk or easy day trip worth planning a day around, and the best time of year for it.`;
  return { slug, city, kind, topic };
}

/** The post as it will be saved: the draft, the guide city's own photo as
 * the cover with the credit its licence asks for, and a line linking to
 * the city's guide if the draft did not already. */
export function postFromDraft(draft: BlogDraft, topic: AutopilotTopic, coverSrc: string | null) {
  const guide = `/destinations/${topic.slug}`;
  const body = draft.body.includes(guide)
    ? draft.body
    : `${draft.body.trim()}\n\nPlanning a visit? Our [${topic.city} guide](${guide}) has the essentials, and decide can plan the whole trip in about a minute.`;
  const credit = DESTINATION_PHOTO_CREDITS[topic.slug];
  return {
    language: "en",
    slug: draft.slug,
    title: draft.title,
    excerpt: draft.excerpt,
    body,
    coverUrl: coverSrc,
    coverAlt: coverSrc ? topic.city : null,
    coverCredit: coverSrc && credit ? `${credit.artist}, ${credit.license}, via Wikimedia Commons` : null,
    coverCreditUrl: coverSrc && credit ? credit.sourceUrl : null,
    destinations: draft.destinations.length > 0 ? draft.destinations : [topic.city],
    sources: draft.sources,
  };
}

export type AutopilotResult =
  | { ok: true; post: { id: string; slug: string; title: string }; topic: AutopilotTopic }
  | { ok: false; detail: string };

/** Writes, saves and publishes one post. Never throws. */
export async function runBlogAutopilot(db: Queryable, client: Anthropic, now = new Date()): Promise<AutopilotResult> {
  try {
    const slugs = listDestinationSlugs();
    const cities = Object.fromEntries(slugs.map((s) => [s, getLocalizedCityName(s, "en", loadDestination(s)?.city ?? s)]));
    const topic = pickTopic(slugs, cities, await listAllPosts(db), now);
    if (!topic) return { ok: false, detail: "No destination guides to write about." };

    const draft = await writeDraft(client, { kind: topic.kind, topic: topic.topic, language: "en", today: now.toISOString().slice(0, 10) });
    if (!draft) return { ok: false, detail: `The draft about ${topic.city} came back unusable.` };

    const raw = postFromDraft(draft, topic, getDestinationPhoto(topic.slug)?.src ?? null);
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
    await setPostStatus(db, saved.id, "published");
    return { ok: true, post: { id: saved.id, slug: parsed.post.slug, title: parsed.post.title }, topic };
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
