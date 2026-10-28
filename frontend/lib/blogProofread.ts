// A copy check for posts that went live before the autopilot had one.
//
// The autopilot now proofreads each post before publishing it
// (reviewDraft in lib/blogDraft.ts). The posts it published before that
// did not get the check, and at least one headline read wrong ("The
// Amsterdam the canal boats never reach"). This puts each published post
// through the same copy editor once, and keeps the corrections that pass
// the same guards: no new facts, links or sections. A post's address
// never changes, so links already shared keep working.
//
// Runs once after a deploy, from the first visit to the blog, and on the
// daily report's run, which picks up anything a run before it missed. A
// post is checked once: Redis remembers it. The starter posts are left
// alone; they were written and read through by hand.
//
// Run: npm run test:blog-proofread (no model)

import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "./anthropicClient";
import { reviewDraft, type DraftReview } from "./blogDraft";
import { listAllPosts, savePost, type BlogPost } from "./blogQuery";
import { STARTER_POSTS } from "./blogStarter";
import { getDb } from "./db";
import { getRedis } from "./redis";

/** Headlines known to read wrong, put right without waiting for a model. */
export const KNOWN_TITLE_FIXES: Record<string, string> = {
  "The Amsterdam the canal boats never reach": "The side of Amsterdam the canal boats never reach",
};

const MAX_PER_RUN = 6;
const REVIEW_TIMEOUT_MS = 40_000;

const checkedKey = (id: string) => `blog:proofread:${id}`;

/** The published posts the check is for: not a starter post. */
export function postsToProofread(posts: BlogPost[]): BlogPost[] {
  const starter = new Set(STARTER_POSTS.map((p) => `${p.language}|${p.slug}`));
  return posts.filter((p) => p.status === "published" && !starter.has(`${p.language}|${p.slug}`));
}

/** The post with the corrections applied, its address kept. Null when
 * nothing should change. */
export function correctedPost(post: BlogPost, review: DraftReview | null) {
  const knownTitle = KNOWN_TITLE_FIXES[post.title.trim()];
  const usable = review && review.publishable ? review : null;
  const title = knownTitle ?? usable?.title ?? post.title;
  const excerpt = usable?.excerpt || post.excerpt;
  const body = usable?.body ?? post.body;
  if (title === post.title && excerpt === post.excerpt && body === post.body) return null;
  return {
    language: post.language,
    slug: post.slug,
    title,
    excerpt,
    body,
    coverUrl: post.coverUrl,
    coverAlt: post.coverAlt,
    coverCredit: post.coverCredit,
    coverCreditUrl: post.coverCreditUrl,
    destinations: post.destinations,
    sources: post.sources,
  };
}

async function alreadyChecked(id: string): Promise<boolean> {
  try {
    return (await getRedis().get(checkedKey(id))) !== null;
  } catch {
    return false;
  }
}

export async function markChecked(id: string): Promise<void> {
  try {
    await getRedis().set(checkedKey(id), "1");
  } catch {
    // Without Redis the post is simply checked again next time.
  }
}

/** Proofreads the published posts not yet checked. Never throws. */
export async function proofreadPublishedPosts(client?: Anthropic): Promise<{ checked: number; corrected: string[] }> {
  const corrected: string[] = [];
  let checked = 0;
  try {
    const db = getDb();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!db) return { checked, corrected };
    const model = client ?? (apiKey ? createAnthropicClient({ apiKey, timeout: REVIEW_TIMEOUT_MS, maxRetries: 0 }) : null);

    const pending: BlogPost[] = [];
    for (const post of postsToProofread(await listAllPosts(db))) {
      if (pending.length >= MAX_PER_RUN) break;
      if (!(await alreadyChecked(post.id))) pending.push(post);
    }

    await Promise.all(
      pending.map(async (post) => {
        const review = model ? await reviewDraft(model, { ...post, imageQuery: "" }, post.language, REVIEW_TIMEOUT_MS) : null;
        const fixed = correctedPost(post, review);
        if (fixed) {
          const saved = await savePost(db, fixed, post.id);
          if (saved.ok) corrected.push(`${post.title} -> ${fixed.title}`);
        }
        // Checked once a model has looked at it; the known headline fixes
        // alone do not count, so a run without a key tries again later.
        if (review) {
          checked++;
          await markChecked(post.id);
        }
      })
    );
  } catch (e) {
    console.warn("[blog-proofread]", e instanceof Error ? e.message : e);
  }
  return { checked, corrected };
}

/** The once-after-a-deploy run, started from a blog page: one visit runs
 * it, every other one skips it straight away. */
export async function proofreadOnceAfterDeploy(): Promise<void> {
  const deploy = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  try {
    const first = await getRedis().set(`blog:proofread-pass:${deploy}`, "1", { nx: true, ex: 30 * 86_400 });
    if (first !== "OK") return;
  } catch {
    return;
  }
  const result = await proofreadPublishedPosts();
  if (result.corrected.length > 0) console.log("[blog-proofread] corrected:", result.corrected.join("; "));
}
