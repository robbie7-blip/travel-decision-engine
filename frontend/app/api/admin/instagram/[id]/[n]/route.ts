// One slide of a blog post's Instagram carousel, as a JPEG to download
// (lib/instagramSlides.tsx). Behind the admin password like everything
// under /api/admin. n counts from 1.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPost } from "@/lib/blogQuery";
import { instagramPackage } from "@/lib/blogAutopilot";
import { instagramSlideImage } from "@/lib/instagramSlides";
import { asJpeg } from "@/lib/tripOgImage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const db = getDb();
  if (!db) return NextResponse.json({ detail: "No database on this deployment." }, { status: 503 });
  const post = await getPost(db, id);
  if (!post) return NextResponse.json({ detail: "No such post." }, { status: 404 });
  const { slides } = instagramPackage(post);
  const index = Number.parseInt(n, 10) - 1;
  const slide = slides[index];
  if (!slide) return NextResponse.json({ detail: "No such slide." }, { status: 404 });
  const image = await asJpeg(await instagramSlideImage(slide, index, slides.length, post.coverUrl));
  const headers = new Headers(image.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", `inline; filename="${post.slug}-${index + 1}.jpg"`);
  return new Response(image.body, { headers });
}
