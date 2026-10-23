// The blog's posts, for /admin/blog. Behind the admin password
// (middleware.ts covers /api/admin/*).
//
// GET   every post, drafts included
// POST  { id?, ...post } creates (no id) or saves a post as it is - a draft
//       stays a draft, a published post stays published with the changes.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listAllPosts, parseBlogInput, savePost } from "@/lib/blogQuery";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ detail: "No database on this deployment (DATABASE_URL is not set)." }, { status: 503 });
  try {
    return NextResponse.json({ posts: await listAllPosts(db) }, { headers: NO_STORE });
  } catch (e) {
    console.warn("[admin/blog]", e instanceof Error ? e.message.slice(0, 200) : e);
    return NextResponse.json({ detail: "Could not read the posts." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ detail: "No database on this deployment (DATABASE_URL is not set)." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseBlogInput(body);
  if (!parsed.ok) return NextResponse.json({ detail: parsed.detail }, { status: 400 });
  const id = typeof body?.id === "string" && body.id.length <= 64 ? body.id : undefined;
  try {
    const saved = await savePost(db, parsed.post, id);
    if (!saved.ok) return NextResponse.json({ detail: saved.detail }, { status: 409 });
    return NextResponse.json({ id: saved.id, slug: parsed.post.slug }, { headers: NO_STORE });
  } catch (e) {
    console.warn("[admin/blog] save:", e instanceof Error ? e.message.slice(0, 200) : e);
    return NextResponse.json({ detail: "Could not save the post." }, { status: 500 });
  }
}
