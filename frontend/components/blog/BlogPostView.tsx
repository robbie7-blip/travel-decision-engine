// One blog post, in either language. Routes: app/blog/[slug] and
// app/bg/blog/[slug]. Server-rendered, so search engines read all of it.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getPublishedPost, listPublishedPosts, type BlogPost, type BlogSummary } from "@/lib/blogQuery";
import { TRANSLATIONS } from "@/lib/i18n";
import { SHARE_CARD } from "@/lib/shareCard";
import { getSiteUrl } from "@/lib/siteUrl";
import { safeHref } from "@/lib/linkify";
import { blogPath, sizedCover } from "@/lib/blogPaths";
import { MiniMarkdown, plainText, readingMinutes } from "@/lib/miniMarkdown";
import type { Language } from "@/lib/types";
import { BlogHeader } from "./BlogHeader";

async function load(language: Language, slug: string): Promise<BlogPost | null> {
  const db = getDb();
  if (!db || slug.length > 120) return null;
  try {
    return await getPublishedPost(db, language, slug);
  } catch {
    return null;
  }
}

function absolute(url: string): string {
  return url.startsWith("/") ? `${getSiteUrl().replace(/\/$/, "")}${url}` : url;
}

export async function blogPostMetadata(language: Language, slug: string): Promise<Metadata> {
  const post = await load(language, slug);
  if (!post) return { title: "decide" };
  const title = `${post.title} - decide`;
  const description = (post.excerpt || plainText(post.body)).slice(0, 200);
  return {
    title,
    description,
    alternates: { canonical: `${getSiteUrl().replace(/\/$/, "")}${blogPath(language, post.slug)}` },
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: post.publishedAt ?? undefined,
      ...(post.coverUrl ? { images: [absolute(sizedCover(post.coverUrl, 1200, 630))] } : SHARE_CARD),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

function formatDate(iso: string | null, language: Language): string {
  return iso ? new Date(iso).toLocaleDateString(language === "bg" ? "bg-BG" : "en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
}

export async function BlogPostView({ language, slug }: { language: Language; slug: string }) {
  const post = await load(language, slug);
  if (!post) notFound();
  const t = TRANSLATIONS[language];
  const db = getDb();
  const more: BlogSummary[] = db
    ? (await listPublishedPosts(db, language, 4).catch(() => [] as BlogSummary[])).filter((p) => p.id !== post.id).slice(0, 3)
    : [];
  const place = post.destinations[0];
  const langSuffix = language === "bg" ? "&lang=bg" : "";
  const planHref = place ? `/?dest=${encodeURIComponent(post.destinations.join(", "))}${langSuffix}` : language === "bg" ? "/?lang=bg" : "/";
  const creditHref = post.coverCreditUrl ? safeHref(post.coverCreditUrl) : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt || undefined,
    inLanguage: language,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.updatedAt,
    image: post.coverUrl ? absolute(sizedCover(post.coverUrl, 1200, 630)) : undefined,
    url: `${getSiteUrl().replace(/\/$/, "")}${blogPath(language, post.slug)}`,
    publisher: { "@type": "Organization", name: "decide" },
  };

  return (
    <div lang={language} style={{ minHeight: "100%" }}>
      <script
        type="application/ld+json"
        // JSON, with "<" escaped so nothing in a title can end the script.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <BlogHeader language={language} contextLink={{ href: blogPath(language), label: `${t.blog.all} →` }} />
      <main className="plan-page blog-page">
        <article>
          <p className="font-ui plan-eyebrow">
            {formatDate(post.publishedAt, language)} · {t.blog.minutesRead.replace("{n}", String(readingMinutes(post.body)))}
          </p>
          <h1 className="font-display plan-title">{post.title}</h1>
          {post.excerpt && <p className="plan-summary">{post.excerpt}</p>}
          {post.coverUrl && (
            <figure className="blog-cover">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote royalty-free photo, sized from its address */}
              <img
                src={sizedCover(post.coverUrl, 1200, 675)}
                srcSet={`${sizedCover(post.coverUrl, 640, 360)} 640w, ${sizedCover(post.coverUrl, 1200, 675)} 1200w`}
                sizes="(max-width: 820px) 100vw, 790px"
                alt={post.coverAlt ?? ""}
                width={1200}
                height={675}
                fetchPriority="high"
              />
              {post.coverCredit && (
                <figcaption className="font-ui">
                  {t.blog.photo}{" "}
                  {creditHref ? (
                    <a href={creditHref} target="_blank" rel="noopener noreferrer">
                      {post.coverCredit}
                    </a>
                  ) : (
                    post.coverCredit
                  )}
                </figcaption>
              )}
            </figure>
          )}
          <div className="blog-body">
            <MiniMarkdown source={post.body} />
          </div>
          <p>
            <Link href={planHref} className="font-ui btn-primary plan-cta">
              {place ? t.blog.planCta.replace("{place}", place) : t.blog.planGeneric}
            </Link>
          </p>
          {post.sources.length > 0 && (
            <section className="blog-sources" aria-labelledby="blog-sources">
              <h2 id="blog-sources" className="font-ui">{t.blog.sources}</h2>
              <ul>
                {post.sources.map((s) => {
                  const href = safeHref(s.url);
                  return <li key={s.url}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}</li>;
                })}
              </ul>
            </section>
          )}
        </article>
        {more.length > 0 && (
          <section className="blog-more" aria-labelledby="blog-more">
            <h2 id="blog-more" className="font-display">{t.blog.more}</h2>
            <ul className="plan-list">
              {more.map((p) => (
                <li key={p.id}>
                  <Link href={blogPath(language, p.slug)} className="plan-card">
                    <span className="font-display plan-card-title">{p.title}</span>
                    {p.excerpt && <span className="plan-card-summary">{p.excerpt}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
