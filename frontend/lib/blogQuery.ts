// The blog: posts in Postgres, written and published from /admin/blog.
//
// The SITE owns this table, not the worker: the worker never touches the
// blog, and the table is created here the first time it is needed
// (ensureBlogSchema), so the blog works whatever state the worker's own
// migrations are in. The statement is idempotent and runs once per warm
// server process.
//
// Shared with worker/src/db.test.ts, which runs it against a real Postgres
// - hence no path aliases and type-only imports, like lib/tripsQuery.ts.

import type { Queryable } from "./tripsQuery";

export type BlogLanguage = "en" | "bg";
export type BlogStatus = "draft" | "published";

export interface BlogSource {
  title: string;
  url: string;
}

export interface BlogPost {
  id: string;
  slug: string;
  language: BlogLanguage;
  status: BlogStatus;
  title: string;
  excerpt: string;
  /** The article, in the small Markdown subset lib/miniMarkdown.tsx renders. */
  body: string;
  coverUrl: string | null;
  coverAlt: string | null;
  /** The photographer, as the photo's source names them. Never made up:
   * a cover without a real credit is published without one. */
  coverCredit: string | null;
  coverCreditUrl: string | null;
  /** The places a post is about, for its "Plan a trip" button. */
  destinations: string[];
  /** What a news post is based on, shown under it. */
  sources: BlogSource[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BlogSummary = Pick<BlogPost, "id" | "slug" | "language" | "title" | "excerpt" | "coverUrl" | "coverAlt" | "publishedAt">;

export const BLOG_SCHEMA_SQL = `
  create table if not exists blog_posts (
    id                text primary key,
    slug              text not null,
    language          text not null check (language in ('en', 'bg')),
    status            text not null default 'draft' check (status in ('draft', 'published')),
    title             text not null,
    excerpt           text not null default '',
    body              text not null default '',
    cover_url         text,
    cover_alt         text,
    cover_credit      text,
    cover_credit_url  text,
    destinations      text[] not null default '{}',
    sources           jsonb not null default '[]',
    published_at      timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (language, slug)
  );
  create index if not exists blog_posts_published on blog_posts (language, published_at desc) where status = 'published';
`;

let schemaReady: Promise<void> | null = null;

/** Creates the table if it does not exist yet, once per process. A failure
 * is not remembered, so the next request tries again. */
export function ensureBlogSchema(db: Queryable): Promise<void> {
  schemaReady ??= db.query(BLOG_SCHEMA_SQL).then(
    () => undefined,
    (e: unknown) => {
      schemaReady = null;
      throw e;
    }
  );
  return schemaReady;
}

/** For tests that drop the table between runs. */
export function resetBlogSchemaCache(): void {
  schemaReady = null;
}

// ---------------------------------------------------------------------------
// Validation: everything a post is saved with passes through here.

export const BLOG_LIMITS = { title: 160, excerpt: 400, body: 40_000, alt: 200, credit: 120, destinations: 6, sources: 12 } as const;

/** Where a cover may come from: the two royalty-free libraries whose
 * licences allow this use, or the site's own destination photos. A photo
 * lifted from anywhere else is exactly what this blog must not do. */
const COVER_HOSTS = new Set(["images.pexels.com", "images.unsplash.com"]);

export function isAllowedCoverUrl(url: string): boolean {
  if (/^\/destinations\/[a-z_]+\.(jpg|jpeg|webp|png)$/.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && COVER_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** "Lisbon's New Night Trams!" -> "lisbons-new-night-trams". Cyrillic is
 * transliterated, so a Bulgarian title still makes a readable address. */
const BG_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht",
  ъ: "a", ь: "y", ю: "yu", я: "ya",
};

export function blogSlug(title: string): string {
  return title
    .toLowerCase()
    .split("")
    .map((ch) => BG_TO_LATIN[ch] ?? ch)
    .join("")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export interface BlogInput {
  slug: string;
  language: BlogLanguage;
  title: string;
  excerpt: string;
  body: string;
  coverUrl: string | null;
  coverAlt: string | null;
  coverCredit: string | null;
  coverCreditUrl: string | null;
  destinations: string[];
  sources: BlogSource[];
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optional = (v: unknown, max: number): string | null => text(v, max) || null;

/** A post from a request body, or the reason it cannot be saved. */
export function parseBlogInput(raw: unknown): { ok: true; post: BlogInput } | { ok: false; detail: string } {
  if (!raw || typeof raw !== "object") return { ok: false, detail: "Body must be a post." };
  const r = raw as Record<string, unknown>;
  const language: BlogLanguage = r.language === "bg" ? "bg" : r.language === "en" ? "en" : ("" as BlogLanguage);
  if (!language) return { ok: false, detail: "Language must be en or bg." };
  const title = text(r.title, BLOG_LIMITS.title);
  if (!title) return { ok: false, detail: "A post needs a title." };
  const slug = blogSlug(text(r.slug, 120) || title);
  if (!slug) return { ok: false, detail: "Could not make an address from that title." };
  const coverUrl = optional(r.coverUrl, 600);
  if (coverUrl && !isAllowedCoverUrl(coverUrl)) {
    return { ok: false, detail: "Cover photos must come from images.pexels.com or images.unsplash.com (royalty-free), or the site's own /destinations photos." };
  }
  const coverCreditUrl = optional(r.coverCreditUrl, 600);
  if (coverCreditUrl && !isHttpUrl(coverCreditUrl)) return { ok: false, detail: "The photo credit link is not a web address." };
  const destinations = (Array.isArray(r.destinations) ? r.destinations : [])
    .map((d) => text(d, 80))
    .filter(Boolean)
    .slice(0, BLOG_LIMITS.destinations);
  const sources: BlogSource[] = [];
  for (const s of Array.isArray(r.sources) ? r.sources : []) {
    const src = s as Record<string, unknown>;
    const url = text(src?.url, 600);
    if (!url) continue;
    if (!isHttpUrl(url)) return { ok: false, detail: `Source is not a web address: ${url.slice(0, 80)}` };
    sources.push({ title: text(src?.title, 200) || new URL(url).hostname, url });
    if (sources.length >= BLOG_LIMITS.sources) break;
  }
  return {
    ok: true,
    post: {
      slug,
      language,
      title,
      excerpt: text(r.excerpt, BLOG_LIMITS.excerpt),
      body: typeof r.body === "string" ? r.body.slice(0, BLOG_LIMITS.body) : "",
      coverUrl,
      coverAlt: optional(r.coverAlt, BLOG_LIMITS.alt),
      coverCredit: coverUrl ? optional(r.coverCredit, BLOG_LIMITS.credit) : null,
      coverCreditUrl: coverUrl ? coverCreditUrl : null,
      destinations,
      sources,
    },
  };
}

// ---------------------------------------------------------------------------
// Queries.

interface PostRow {
  id: string;
  slug: string;
  language: string;
  status: string;
  title: string;
  excerpt: string;
  body: string;
  cover_url: string | null;
  cover_alt: string | null;
  cover_credit: string | null;
  cover_credit_url: string | null;
  destinations: string[];
  sources: unknown;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

function toPost(r: PostRow): BlogPost {
  return {
    id: r.id,
    slug: r.slug,
    language: r.language === "bg" ? "bg" : "en",
    status: r.status === "published" ? "published" : "draft",
    title: r.title,
    excerpt: r.excerpt,
    body: r.body,
    coverUrl: r.cover_url,
    coverAlt: r.cover_alt,
    coverCredit: r.cover_credit,
    coverCreditUrl: r.cover_credit_url,
    destinations: r.destinations ?? [],
    sources: Array.isArray(r.sources) ? (r.sources as BlogSource[]) : [],
    publishedAt: iso(r.published_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

const SUMMARY_COLUMNS = "id, slug, language, title, excerpt, cover_url, cover_alt, published_at";

export async function listPublishedPosts(db: Queryable, language: BlogLanguage, limit = 60): Promise<BlogSummary[]> {
  await ensureBlogSchema(db);
  const { rows } = await db.query<PostRow>(
    `select ${SUMMARY_COLUMNS} from blog_posts where status = 'published' and language = $1 order by published_at desc limit $2`,
    [language, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    language: r.language === "bg" ? "bg" : "en",
    title: r.title,
    excerpt: r.excerpt,
    coverUrl: r.cover_url,
    coverAlt: r.cover_alt,
    publishedAt: iso(r.published_at),
  }));
}

export async function getPublishedPost(db: Queryable, language: BlogLanguage, slug: string): Promise<BlogPost | null> {
  await ensureBlogSchema(db);
  const { rows } = await db.query<PostRow>(
    "select * from blog_posts where status = 'published' and language = $1 and slug = $2",
    [language, slug]
  );
  return rows[0] ? toPost(rows[0]) : null;
}

/** Every post, drafts included, for the admin list. */
export async function listAllPosts(db: Queryable, limit = 200): Promise<BlogPost[]> {
  await ensureBlogSchema(db);
  const { rows } = await db.query<PostRow>("select * from blog_posts order by updated_at desc limit $1", [limit]);
  return rows.map(toPost);
}

export async function getPost(db: Queryable, id: string): Promise<BlogPost | null> {
  await ensureBlogSchema(db);
  const { rows } = await db.query<PostRow>("select * from blog_posts where id = $1", [id]);
  return rows[0] ? toPost(rows[0]) : null;
}

/** Creates a post (no id) or updates one. The address must be unique per
 * language; a clash comes back as an error the editor can show. */
export async function savePost(db: Queryable, post: BlogInput, id?: string): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  await ensureBlogSchema(db);
  const clash = await db.query<{ id: string }>("select id from blog_posts where language = $1 and slug = $2", [post.language, post.slug]);
  if (clash.rows[0] && clash.rows[0].id !== id) {
    return { ok: false, detail: `Another ${post.language === "bg" ? "Bulgarian" : "English"} post already uses the address "${post.slug}".` };
  }
  const values = [
    post.slug,
    post.language,
    post.title,
    post.excerpt,
    post.body,
    post.coverUrl,
    post.coverAlt,
    post.coverCredit,
    post.coverCreditUrl,
    post.destinations,
    JSON.stringify(post.sources),
  ];
  if (id) {
    const { rows } = await db.query<{ id: string }>(
      `update blog_posts set slug = $1, language = $2, title = $3, excerpt = $4, body = $5, cover_url = $6, cover_alt = $7,
         cover_credit = $8, cover_credit_url = $9, destinations = $10, sources = $11::jsonb, updated_at = now()
       where id = $12 returning id`,
      [...values, id]
    );
    return rows[0] ? { ok: true, id } : { ok: false, detail: "That post no longer exists." };
  }
  const newId = globalThis.crypto.randomUUID();
  await db.query(
    `insert into blog_posts (id, slug, language, title, excerpt, body, cover_url, cover_alt, cover_credit, cover_credit_url, destinations, sources)
     values ($12, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [...values, newId]
  );
  return { ok: true, id: newId };
}

/** Publishing keeps the first publication date, so a post edited later is
 * not presented as new. */
export async function setPostStatus(db: Queryable, id: string, status: BlogStatus): Promise<boolean> {
  await ensureBlogSchema(db);
  const { rows } = await db.query<{ id: string }>(
    `update blog_posts set status = $2, updated_at = now(),
       published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end
     where id = $1 returning id`,
    [id, status]
  );
  return rows.length > 0;
}

export async function deletePost(db: Queryable, id: string): Promise<boolean> {
  await ensureBlogSchema(db);
  const { rows } = await db.query<{ id: string }>("delete from blog_posts where id = $1 returning id", [id]);
  return rows.length > 0;
}
