"use client";

// The admin's blog editor (app/admin/blog/[id]). Draft with Claude, edit,
// preview, save, publish. Nothing reaches the public blog until Publish.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BlogPost, BlogSource } from "@/lib/blogQuery";
import { blogSlug, isAllowedCoverUrl } from "@/lib/blogQuery";
import { blogPath, sizedCover } from "@/lib/blogPaths";
import { MiniMarkdown } from "@/lib/miniMarkdown";
import type { BlogDraft, CoverPhoto, DraftKind } from "@/lib/blogDraft";

interface Fields {
  language: "en" | "bg";
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  coverUrl: string;
  coverAlt: string;
  coverCredit: string;
  coverCreditUrl: string;
  destinations: string;
  sources: string;
}

function toFields(post: BlogPost | null): Fields {
  return {
    language: post?.language ?? "en",
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    excerpt: post?.excerpt ?? "",
    body: post?.body ?? "",
    coverUrl: post?.coverUrl ?? "",
    coverAlt: post?.coverAlt ?? "",
    coverCredit: post?.coverCredit ?? "",
    coverCreditUrl: post?.coverCreditUrl ?? "",
    destinations: (post?.destinations ?? []).join(", "),
    sources: (post?.sources ?? []).map((s) => `${s.title} | ${s.url}`).join("\n"),
  };
}

/** "Title | https://..." per line, or just the address. */
function parseSources(text: string): BlogSource[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.lastIndexOf("|");
      return bar > 0 ? { title: line.slice(0, bar).trim(), url: line.slice(bar + 1).trim() } : { title: "", url: line };
    });
}

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 16,
  fontFamily: "inherit",
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--bg-panel)",
  color: "var(--ink)",
};
const label: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--ink-dim)", margin: "14px 0 4px" };
const button: React.CSSProperties = {
  minHeight: 44,
  padding: "0 16px",
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--bg-panel)",
  color: "var(--ink)",
  cursor: "pointer",
};

export function BlogEditor({ initial, hasPexels }: { initial: BlogPost | null; hasPexels: boolean }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [status, setStatus] = useState(initial?.status ?? "draft");
  const [f, setF] = useState<Fields>(toFields(initial));
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState<DraftKind>("destination");

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setF((prev) => ({ ...prev, [k]: value, ...(k === "title" && !slugTouched ? { slug: blogSlug(value) } : {}) }));
    if (k === "slug") setSlugTouched(true);
  };

  async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${res.status}).`);
    return data;
  }

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function save(): Promise<string> {
    const data = await call("/api/admin/blog", {
      method: "POST",
      body: JSON.stringify({
        id: id ?? undefined,
        language: f.language,
        title: f.title,
        slug: f.slug,
        excerpt: f.excerpt,
        body: f.body,
        coverUrl: f.coverUrl || null,
        coverAlt: f.coverAlt || null,
        coverCredit: f.coverCredit || null,
        coverCreditUrl: f.coverCreditUrl || null,
        destinations: f.destinations.split(",").map((d) => d.trim()).filter(Boolean),
        sources: parseSources(f.sources),
      }),
    });
    const savedId = String(data.id);
    if (typeof data.slug === "string") setF((prev) => ({ ...prev, slug: data.slug as string }));
    if (!id) {
      setId(savedId);
      router.replace(`/admin/blog/${savedId}`);
    }
    return savedId;
  }

  const draft = () =>
    run("draft", async () => {
      const data = await call("/api/admin/blog/draft", { method: "POST", body: JSON.stringify({ topic, kind, language: f.language }) });
      const d = data.draft as BlogDraft;
      const cover = data.cover as CoverPhoto | null;
      setF((prev) => ({
        ...prev,
        title: d.title,
        slug: d.slug,
        excerpt: d.excerpt,
        body: d.body,
        destinations: d.destinations.join(", "),
        sources: d.sources.map((s) => `${s.title} | ${s.url}`).join("\n"),
        ...(cover ? { coverUrl: cover.url, coverAlt: cover.alt, coverCredit: cover.credit, coverCreditUrl: cover.creditUrl } : {}),
      }));
      setSlugTouched(false);
      setMessage(
        `Draft ready. Read it through and check every fact before publishing.${
          cover ? "" : ` No cover photo: choose one on Pexels or Unsplash${d.imageQuery ? ` (try "${d.imageQuery}")` : ""} and paste its image address and photographer below.`
        }`
      );
    });

  const onSave = () =>
    run("save", async () => {
      await save();
      setMessage(status === "published" ? "Saved. The live post is updated." : "Saved as a draft.");
    });

  const onPublish = (next: "published" | "draft") =>
    run(next, async () => {
      const savedId = await save();
      await call(`/api/admin/blog/${savedId}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      setStatus(next);
      setMessage(next === "published" ? "Published." : "Taken down: it is a draft again.");
    });

  const onDelete = () => {
    if (!id || !window.confirm("Delete this post for good?")) return;
    void run("delete", async () => {
      await call(`/api/admin/blog/${id}`, { method: "DELETE" });
      router.push("/admin/blog");
    });
  };

  const coverOk = !f.coverUrl || isAllowedCoverUrl(f.coverUrl);

  return (
    <div>
      <h1 className="font-display" style={{ fontSize: 24, margin: "10px 0 4px" }}>
        {initial ? "Edit post" : "New post"}{" "}
        <span style={{ fontSize: 13, color: status === "published" ? "var(--grounded)" : "var(--ink-dim)" }}>({status})</span>
      </h1>

      <section style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "12px 16px", margin: "16px 0", background: "var(--bg-panel-raised)" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Draft with Claude</div>
        <label style={label} htmlFor="draft-topic">
          Topic (for example: &quot;Matera, the cave city of southern Italy&quot; or &quot;new direct flights from Sofia this winter&quot;)
        </label>
        <input id="draft-topic" style={field} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={500} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <select aria-label="Kind of post" style={{ ...field, width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
            <option value="destination">Destination</option>
            <option value="story">Story</option>
            <option value="news">News (searches the web, cites sources)</option>
          </select>
          <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>in {f.language === "bg" ? "Bulgarian" : "English"} (set below)</span>
          <button type="button" style={button} onClick={draft} disabled={!topic.trim() || busy !== null}>
            {busy === "draft" ? "Writing… (up to a minute)" : "Write draft"}
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-dim)", margin: "8px 0 0" }}>
          Replaces the fields below. {hasPexels ? "A cover photo is picked from Pexels." : "Set PEXELS_API_KEY to have a cover photo picked automatically."}
        </p>
      </section>

      {message && <p style={{ color: "var(--grounded)", fontSize: 13 }}>{message}</p>}
      {error && <p role="alert" style={{ color: "var(--infeasible)", fontSize: 13 }}>{error}</p>}

      <label style={label} htmlFor="b-lang">Language</label>
      <select id="b-lang" style={{ ...field, width: "auto" }} value={f.language} onChange={set("language")}>
        <option value="en">English (/blog)</option>
        <option value="bg">Bulgarian (/bg/blog)</option>
      </select>

      <label style={label} htmlFor="b-title">Title</label>
      <input id="b-title" style={field} value={f.title} onChange={set("title")} maxLength={160} />

      <label style={label} htmlFor="b-slug">Address: {blogPath(f.language, f.slug || "…")}</label>
      <input id="b-slug" style={field} value={f.slug} onChange={set("slug")} maxLength={120} />

      <label style={label} htmlFor="b-excerpt">Excerpt (post list and Google)</label>
      <textarea id="b-excerpt" style={{ ...field, minHeight: 60 }} value={f.excerpt} onChange={set("excerpt")} maxLength={400} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end" }}>
        <label style={label} htmlFor="b-body">Article (## heading, - list, **bold**, *italic*, [link](https://…))</label>
        <button type="button" style={{ ...button, minHeight: 36 }} onClick={() => setPreview((p) => !p)}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="blog-body" style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "8px 16px", fontFamily: "var(--font-body)" }}>
          <MiniMarkdown source={f.body} />
        </div>
      ) : (
        <textarea id="b-body" style={{ ...field, minHeight: 360, fontSize: 14, lineHeight: 1.5 }} value={f.body} onChange={set("body")} />
      )}

      <label style={label} htmlFor="b-dest">Places (comma separated; the first one names the &quot;Plan a trip&quot; button)</label>
      <input id="b-dest" style={field} value={f.destinations} onChange={set("destinations")} />

      <label style={label} htmlFor="b-sources">Sources, one per line: Title | https://…</label>
      <textarea id="b-sources" style={{ ...field, minHeight: 70, fontSize: 13 }} value={f.sources} onChange={set("sources")} />

      <label style={label} htmlFor="b-cover">Cover photo address (images.pexels.com or images.unsplash.com only)</label>
      <input id="b-cover" style={{ ...field, borderColor: coverOk ? "var(--line)" : "var(--infeasible)" }} value={f.coverUrl} onChange={set("coverUrl")} />
      {f.coverUrl && coverOk && (
        // eslint-disable-next-line @next/next/no-img-element -- admin preview of a remote photo
        <img src={sizedCover(f.coverUrl, 480, 270)} alt="" width={480} height={270} style={{ marginTop: 8, borderRadius: 6, maxWidth: "100%", height: "auto" }} />
      )}
      <label style={label} htmlFor="b-alt">Photo description (for screen readers)</label>
      <input id="b-alt" style={field} value={f.coverAlt} onChange={set("coverAlt")} maxLength={200} />
      <label style={label} htmlFor="b-credit">Photographer, as the photo&apos;s page names them (e.g. &quot;Jane Doe on Pexels&quot;)</label>
      <input id="b-credit" style={field} value={f.coverCredit} onChange={set("coverCredit")} maxLength={120} />
      <label style={label} htmlFor="b-credit-url">Photographer&apos;s page</label>
      <input id="b-credit-url" style={field} value={f.coverCreditUrl} onChange={set("coverCreditUrl")} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "24px 0 40px" }}>
        <button type="button" style={button} onClick={onSave} disabled={busy !== null || !f.title.trim()}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {status === "published" ? (
          <button type="button" style={button} onClick={() => onPublish("draft")} disabled={busy !== null}>
            {busy === "draft" ? "Taking down…" : "Unpublish"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            style={{ ...button, border: 0 }}
            onClick={() => onPublish("published")}
            disabled={busy !== null || !f.title.trim()}
          >
            {busy === "published" ? "Publishing…" : "Save and publish"}
          </button>
        )}
        {status === "published" && f.slug && (
          <a href={blogPath(f.language, f.slug)} target="_blank" rel="noopener noreferrer" style={{ ...button, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            View live
          </a>
        )}
        {id && (
          <button type="button" style={{ ...button, color: "var(--infeasible)" }} onClick={onDelete} disabled={busy !== null}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
