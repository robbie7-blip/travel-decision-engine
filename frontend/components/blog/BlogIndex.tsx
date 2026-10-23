// The blog's front page, in either language: newest post first. Routes:
// app/blog (English) and app/bg/blog (Bulgarian).

import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { listPublishedPosts, type BlogSummary } from "@/lib/blogQuery";
import { TRANSLATIONS } from "@/lib/i18n";
import { SHARE_CARD } from "@/lib/shareCard";
import { getSiteUrl } from "@/lib/siteUrl";
import { blogPath, sizedCover } from "@/lib/blogPaths";
import type { Language } from "@/lib/types";
import { BlogHeader } from "./BlogHeader";

export function blogIndexMetadata(language: Language): Metadata {
  const t = TRANSLATIONS[language].blog;
  const title = `${t.indexTitle} - decide`;
  const site = getSiteUrl().replace(/\/$/, "");
  return {
    title,
    description: t.indexIntro,
    alternates: { canonical: `${site}${blogPath(language)}`, languages: { en: `${site}/blog`, bg: `${site}/bg/blog`, "x-default": `${site}/blog` } },
    openGraph: { title, description: t.indexIntro, ...SHARE_CARD },
  };
}

function formatDate(iso: string | null, language: Language): string {
  return iso ? new Date(iso).toLocaleDateString(language === "bg" ? "bg-BG" : "en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
}

export async function BlogIndex({ language }: { language: Language }) {
  const t = TRANSLATIONS[language];
  const db = getDb();
  let posts: BlogSummary[] = [];
  if (db) {
    try {
      posts = await listPublishedPosts(db, language);
    } catch (e) {
      // A database that is down shows an empty blog, not an error page.
      console.warn("[blog] could not list posts:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }

  return (
    <div lang={language} style={{ minHeight: "100%" }}>
      <BlogHeader language={language} contextLink={{ href: language === "bg" ? "/?lang=bg" : "/", label: `${t.trip.planAnother} →` }} />
      <main className="plan-page blog-page">
        <h1 className="font-display plan-title">{t.blog.indexTitle}</h1>
        <p className="plan-summary">{t.blog.indexIntro}</p>
        {posts.length === 0 ? (
          <p className="font-ui plan-note">{t.blog.empty}</p>
        ) : (
          <ul className="blog-grid">
            {posts.map((post, i) => (
              <li key={post.id}>
                <Link href={blogPath(language, post.slug)} className="blog-card">
                  {post.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- remote royalty-free photo, sized from its address
                    <img
                      src={sizedCover(post.coverUrl, 720, 405)}
                      alt=""
                      width={720}
                      height={405}
                      loading={i < 2 ? "eager" : "lazy"}
                      className="blog-card-photo"
                    />
                  )}
                  <span className="blog-card-body">
                    <span className="font-ui blog-card-date">{formatDate(post.publishedAt, language)}</span>
                    <span className="font-display blog-card-title">{post.title}</span>
                    {post.excerpt && <span className="blog-card-excerpt">{post.excerpt}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
