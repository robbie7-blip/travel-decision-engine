// Runs the blog autopilot (lib/blogAutopilot.ts) and tells the owner.
//
// Called after the daily report on Mondays and Thursdays, and by the
// "Write a post now" button on /admin/blog. Once per day at most when
// scheduled: Vercel can deliver a cron twice, and two posts about the same
// city on one morning would be the visible result. The email goes to
// ADMIN_REPORT_EMAIL and nowhere else, like the daily report.

import { createAnthropicClient } from "./anthropicClient";
import { blogPath } from "./blogPaths";
import { getPost } from "./blogQuery";
import { instagramPackage, isAutopilotDay, runBlogAutopilot, type AutopilotResult } from "./blogAutopilot";
import { markChecked } from "./blogProofread";
import { getDb } from "./db";
import { sendItineraryEmail } from "./email";
import { getRedis } from "./redis";
import { getSiteUrl } from "./siteUrl";

/** What the last run did, for /admin/blog: written when a run starts and
 * again when it ends, so a run the platform cut off shows as one that
 * started and never finished rather than as nothing at all. */
export const LAST_RUN_KEY = "blog:autopilot:last";

export interface AutopilotRunRecord {
  startedAt: number;
  finishedAt?: number;
  scheduled: boolean;
  /** The evening catch-up for a post day the morning run missed. */
  catchUp?: boolean;
  outcome?: "published" | "draft" | "failed";
  title?: string;
  detail?: string;
}

async function recordRun(record: AutopilotRunRecord): Promise<void> {
  try {
    await getRedis().set(LAST_RUN_KEY, JSON.stringify(record), { ex: 30 * 86_400 });
  } catch {
    // Visibility only; a run never fails for want of it.
  }
}

export async function readLastRun(): Promise<AutopilotRunRecord | null> {
  try {
    const raw = await getRedis().get<string | AutopilotRunRecord>(LAST_RUN_KEY);
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as AutopilotRunRecord) : raw;
  } catch {
    return null;
  }
}

/** The post day the evening catch-up should write for, or null when there
 * is none: the most recent Monday or Thursday within the last two days
 * whose post did not go out (the run was cut off, failed, or only saved a
 * draft). Today's own morning run is given until 08:00 UTC, and a run
 * still writing is left alone. */
export function catchUpDay(now: Date, last: AutopilotRunRecord | null): Date | null {
  for (let back = 0; back <= 2; back++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back, 6, 0));
    if (!isAutopilotDay(day)) continue;
    const dayStart = day.getTime() - 6 * 3_600_000;
    if (back === 0 && now.getTime() < dayStart + 8 * 3_600_000) return null;
    if (last && last.startedAt >= dayStart) {
      if (last.outcome === "published") return null;
      if (!last.finishedAt && now.getTime() - last.startedAt < 6 * 60_000) return null;
    }
    return day;
  }
  return null;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function runAutopilotAndNotify(opts: {
  scheduled: boolean;
  now?: Date;
  /** The evening catch-up (see catchUpDay): once per post day. */
  catchUp?: boolean;
}): Promise<AutopilotResult | { ok: false; detail: string; skipped: true }> {
  const now = opts.now ?? new Date();
  const db = getDb();
  if (!db) return { ok: false, detail: "No database on this deployment (DATABASE_URL is not set)." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: "ANTHROPIC_API_KEY is not set on this deployment." };

  if (opts.scheduled) {
    try {
      const lock = `blog:autopilot:${opts.catchUp ? "catchup:" : ""}${now.toISOString().slice(0, 10)}`;
      const first = await getRedis().set(lock, "1", { nx: true, ex: 3 * 86_400 });
      if (first !== "OK") return { ok: false, detail: "Already ran today.", skipped: true };
    } catch {
      // No Redis, no lock: running is still better than skipping the week.
    }
  }

  const startedAt = Date.now();
  await recordRun({ startedAt, scheduled: opts.scheduled, catchUp: opts.catchUp });
  // Each call is also held to the run's own deadline (lib/blogDraft.ts).
  const client = createAnthropicClient({ apiKey, timeout: 170_000, maxRetries: 0 });
  const result = await runBlogAutopilot(db, client, now);
  await recordRun({
    startedAt,
    finishedAt: Date.now(),
    scheduled: opts.scheduled,
    catchUp: opts.catchUp,
    outcome: result.ok ? result.status : "failed",
    title: result.ok ? result.post.title : undefined,
    detail: result.ok ? result.issues.join(" ") || undefined : result.detail,
  });

  // Proofread before it went live: the catch-up check can skip it.
  if (result.ok && result.status === "published") await markChecked(result.post.id);

  const to = process.env.ADMIN_REPORT_EMAIL?.trim();
  if (to) {
    const site = getSiteUrl();
    try {
      if (result.ok && result.status === "draft") {
        const issues = result.issues.length > 0 ? `<ul>${result.issues.map((i) => `<li>${escape(i)}</li>`).join("")}</ul>` : "";
        await sendItineraryEmail(
          to,
          `Blog post saved as a draft: ${result.post.title}`,
          `<p>Today's post (${escape(result.topic.city)}, ${escape(result.topic.kind)}) was written but <strong>not published</strong>: the copy check was not happy with it, or did not finish in time.</p>` +
            issues +
            (opts.catchUp
              ? `<p>That was today's second try, so the next post comes on the next Monday or Thursday. The draft stays in <a href="${site}/admin/blog">/admin/blog</a> if you want it.</p>`
              : `<p>Nothing to do: this evening's run writes and publishes a different post. The draft stays in <a href="${site}/admin/blog">/admin/blog</a> if you want it.</p>`)
        );
      } else if (result.ok) {
        const post = await getPost(db, result.post.id);
        const pkg = post ? instagramPackage(post) : null;
        const postUrl = `${site}${blogPath("en", result.post.slug)}`;
        const packageUrl = `${site}/admin/instagram/${result.post.id}`;
        await sendItineraryEmail(
          to,
          `New on the blog: ${result.post.title}`,
          `<p>A new post is live: <a href="${postUrl}">${escape(result.post.title)}</a> (${escape(result.topic.city)}, ${escape(result.topic.kind)}).</p>` +
            `<p><a href="${packageUrl}"><strong>Open the Instagram post</strong></a>: the slides to download and the caption to copy.</p>` +
            (pkg ? `<p>Caption:</p><pre style="white-space:pre-wrap;font-family:inherit">${escape(pkg.caption)}</pre>` : "") +
            `<p>If anything in it reads wrong, unpublish it from <a href="${site}/admin/blog">/admin/blog</a>.</p>`
        );
      } else {
        await sendItineraryEmail(
          to,
          "The blog autopilot did not post today",
          `<p>${escape(result.detail)}</p>` +
            (opts.catchUp
              ? `<p>That was today's second try, so the next post comes on the next Monday or Thursday.</p>`
              : `<p>Nothing to do: this evening's run tries again by itself.</p>`)
        );
      }
    } catch (e) {
      console.warn("[blog-autopilot] email failed:", e instanceof Error ? e.message : e);
    }
  }
  return result;
}
