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
import { instagramPackage, runBlogAutopilot, type AutopilotResult } from "./blogAutopilot";
import { getDb } from "./db";
import { sendItineraryEmail } from "./email";
import { getRedis } from "./redis";
import { getSiteUrl } from "./siteUrl";

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function runAutopilotAndNotify(opts: { scheduled: boolean; now?: Date }): Promise<AutopilotResult | { ok: false; detail: string; skipped: true }> {
  const now = opts.now ?? new Date();
  const db = getDb();
  if (!db) return { ok: false, detail: "No database on this deployment (DATABASE_URL is not set)." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: "ANTHROPIC_API_KEY is not set on this deployment." };

  if (opts.scheduled) {
    try {
      const first = await getRedis().set(`blog:autopilot:${now.toISOString().slice(0, 10)}`, "1", { nx: true, ex: 2 * 86_400 });
      if (first !== "OK") return { ok: false, detail: "Already ran today.", skipped: true };
    } catch {
      // No Redis, no lock: running is still better than skipping the week.
    }
  }

  const client = createAnthropicClient({ apiKey, timeout: 55_000, maxRetries: 0 });
  const result = await runBlogAutopilot(db, client, now);

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
            `<p>Read it in <a href="${site}/admin/blog">/admin/blog</a>, fix anything that reads wrong, and publish it from there. The Instagram post is at <a href="${site}/admin/instagram/${result.post.id}">/admin/instagram</a> once it is live.</p>`
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
        await sendItineraryEmail(to, "The blog autopilot did not post today", `<p>${escape(result.detail)}</p><p>You can try again from <a href="${site}/admin/blog">/admin/blog</a> with "Write a post now".</p>`);
      }
    } catch (e) {
      console.warn("[blog-autopilot] email failed:", e instanceof Error ? e.message : e);
    }
  }
  return result;
}
