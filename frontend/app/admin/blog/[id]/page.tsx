// The blog editor (password-protected): /admin/blog/new for a new post,
// /admin/blog/<id> for an existing one.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getPost } from "@/lib/blogQuery";
import { MarkAdminUi } from "@/components/MarkAdminUi";
import { BlogEditor } from "@/components/blog/BlogEditor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminBlogEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const post = id === "new" || !db ? null : await getPost(db, id).catch(() => null);
  if (id !== "new" && !post) notFound();
  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 1000, margin: "0 auto", color: "var(--ink)" }}>
      <MarkAdminUi />
      <Link href="/admin/blog" style={{ color: "var(--grounded)", fontSize: 12, textDecoration: "none" }}>
        ← All posts
      </Link>
      <BlogEditor initial={post} hasPexels={Boolean(process.env.PEXELS_API_KEY)} />
    </div>
  );
}
