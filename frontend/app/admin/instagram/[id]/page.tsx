// A blog post's Instagram post, ready to upload (password-protected): the
// carousel slides to download, in order, and the caption to copy. Linked
// from the email the blog autopilot sends (lib/blogAutopilotRun.ts), and
// from each published post on /admin/blog.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getPost } from "@/lib/blogQuery";
import { instagramPackage } from "@/lib/blogAutopilot";
import { blogPath } from "@/lib/blogPaths";
import { MarkAdminUi } from "@/components/MarkAdminUi";
import { CopyCaption } from "@/components/blog/CopyCaption";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminInstagramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const post = db ? await getPost(db, id).catch(() => null) : null;
  if (!post) notFound();
  const { slides, caption } = instagramPackage(post);
  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 1100, margin: "0 auto", color: "var(--ink)" }}>
      <MarkAdminUi />
      <Link href="/admin/blog" style={{ color: "var(--grounded)", fontSize: 12, textDecoration: "none" }}>
        ← All posts
      </Link>
      <h1 className="font-display" style={{ fontSize: 24, margin: "10px 0 6px" }}>
        Instagram: {post.title}
      </h1>
      <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 20px" }}>
        A carousel of {slides.length}. Download the slides in order and upload them as one post, then paste the caption.{" "}
        <a href={blogPath(post.language, post.slug)} style={{ color: "var(--grounded)" }}>
          The post on the blog
        </a>
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
        {slides.map((slide, i) => {
          const src = `/api/admin/instagram/${post.id}/${i + 1}`;
          return (
            <figure key={i} style={{ margin: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated image to download, not page content */}
              <img src={src} alt={`Slide ${i + 1}: ${slide.title}`} style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
              <figcaption style={{ fontSize: 12, marginTop: 6 }}>
                <a href={src} download={`${post.slug}-${i + 1}.jpg`} style={{ color: "var(--grounded)" }}>
                  Download slide {i + 1}
                </a>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <h2 className="font-display" style={{ fontSize: 18, margin: "28px 0 10px" }}>
        Caption
      </h2>
      <CopyCaption caption={caption} />
    </div>
  );
}
