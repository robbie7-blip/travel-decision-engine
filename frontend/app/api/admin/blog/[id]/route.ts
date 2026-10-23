// One post, for /admin/blog/<id>. Behind the admin password.
//
// GET     the post, drafts included
// PATCH   { status: "published" | "draft" } publishes or takes it down
// DELETE  removes it

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { deletePost, getPost, setPostStatus } from "@/lib/blogQuery";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function crossOrigin(request: NextRequest) {
  return isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))
    ? NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 })
    : null;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  if (!db) return NextResponse.json({ detail: "No database." }, { status: 503 });
  const post = await getPost(db, id).catch(() => null);
  return post ? NextResponse.json({ post }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ detail: "Not found." }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const db = getDb();
  if (!db) return NextResponse.json({ detail: "No database." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status === "published" ? "published" : body?.status === "draft" ? "draft" : null;
  if (!status) return NextResponse.json({ detail: "status must be published or draft." }, { status: 400 });
  if (status === "published") {
    // Not published half-made: a post goes out with a title and an article.
    const post = await getPost(db, id).catch(() => null);
    if (!post) return NextResponse.json({ detail: "Not found." }, { status: 404 });
    if (!post.title || post.body.trim().length < 200) {
      return NextResponse.json({ detail: "Write the article (at least a few paragraphs) before publishing." }, { status: 400 });
    }
  }
  const ok = await setPostStatus(db, id, status).catch(() => false);
  return ok ? NextResponse.json({ status }) : NextResponse.json({ detail: "Not found." }, { status: 404 });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const db = getDb();
  if (!db) return NextResponse.json({ detail: "No database." }, { status: 503 });
  const ok = await deletePost(db, id).catch(() => false);
  return ok ? NextResponse.json({ deleted: id }) : NextResponse.json({ detail: "Not found." }, { status: 404 });
}
