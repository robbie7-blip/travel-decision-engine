// The blog's posts, drafts included (password-protected, see
// middleware.ts). Each opens in the editor; "New post" starts one, with
// "Draft with Claude" at the top of the editor.

import Link from "next/link";
import { getDb } from "@/lib/db";
import { listAllPosts, type BlogPost } from "@/lib/blogQuery";
import { blogPath } from "@/lib/blogPaths";
import { MarkAdminUi } from "@/components/MarkAdminUi";
import { StarterPostsButton } from "@/components/blog/StarterPostsButton";
import { AutopilotButton } from "@/components/blog/AutopilotButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminBlogPage() {
  const db = getDb();
  let posts: BlogPost[] = [];
  let error: string | null = null;
  if (db) {
    try {
      posts = await listAllPosts(db);
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).replace(/postgres(?:ql)?:\/\/\S+/gi, "[connection string]").slice(0, 200);
    }
  }
  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 1000, margin: "0 auto", color: "var(--ink)" }}>
      <MarkAdminUi />
      <Link href="/admin" style={{ color: "var(--grounded)", fontSize: 12, textDecoration: "none" }}>
        ← Admin
      </Link>
      <h1 className="font-display" style={{ fontSize: 24, margin: "10px 0 8px" }}>
        Blog
      </h1>
      <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 6px" }}>
        A new post is written and published automatically every Monday and Thursday morning, and its Instagram post is emailed to you.
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 18px" }}>
        Public at <Link href="/blog" style={{ color: "var(--grounded)" }}>/blog</Link> and <Link href="/bg/blog" style={{ color: "var(--grounded)" }}>/bg/blog</Link>. Drafts are visible only here.
      </p>
      <p>
        <Link href="/admin/blog/new" className="font-ui btn-primary" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 18px", fontSize: 13 }}>
          New post
        </Link>
        {db && <StarterPostsButton />}
        {db && <AutopilotButton />}
      </p>
      {!db ? (
        <p style={{ color: "var(--ink-dim)" }}>No database on this deployment (DATABASE_URL is not set).</p>
      ) : error ? (
        <p style={{ color: "var(--infeasible)" }}>Could not read posts: {error}</p>
      ) : posts.length === 0 ? (
        <p style={{ color: "var(--ink-dim)" }}>No posts yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-dim)" }}>
              {["Status", "Lang", "Title", "Updated", ""].map((h) => (
                <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", fontWeight: 500 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td style={{ padding: 8, borderBottom: "1px solid var(--line)", color: p.status === "published" ? "var(--grounded)" : "var(--ink-dim)" }}>
                  {p.status}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>{p.language}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>
                  <Link href={`/admin/blog/${p.id}`} style={{ color: "var(--ink)" }}>
                    {p.title}
                  </Link>
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{p.updatedAt.slice(0, 10)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                  {p.status === "published" && (
                    <>
                      <a href={blogPath(p.language, p.slug)} style={{ color: "var(--grounded)" }}>
                        view →
                      </a>{" "}
                      <Link href={`/admin/instagram/${p.id}`} style={{ color: "var(--grounded)", marginLeft: 8 }}>
                        Instagram →
                      </Link>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
