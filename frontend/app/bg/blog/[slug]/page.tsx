import type { Metadata } from "next";
import { BlogPostView, blogPostMetadata } from "@/components/blog/BlogPostView";

// One Bulgarian blog post.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return blogPostMetadata("bg", slug);
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BlogPostView language="bg" slug={slug} />;
}
