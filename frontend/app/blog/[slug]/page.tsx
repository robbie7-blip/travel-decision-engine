import type { Metadata } from "next";
import { after } from "next/server";
import { proofreadOnceAfterDeploy } from "@/lib/blogProofread";
import { BlogPostView, blogPostMetadata } from "@/components/blog/BlogPostView";

// One English blog post.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Room for the one-off copy check after a deploy (lib/blogProofread.ts),
// which runs after the page has been sent.
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return blogPostMetadata("en", slug);
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  after(proofreadOnceAfterDeploy);
  return <BlogPostView language="en" slug={slug} />;
}
