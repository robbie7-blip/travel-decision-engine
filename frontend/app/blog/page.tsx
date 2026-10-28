import type { Metadata } from "next";
import { after } from "next/server";
import { proofreadOnceAfterDeploy } from "@/lib/blogProofread";
import { BlogIndex, blogIndexMetadata } from "@/components/blog/BlogIndex";

// The English blog. Read from Postgres on each request: posts are
// published from /admin/blog at any time.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Room for the one-off copy check after a deploy (lib/blogProofread.ts),
// which runs after the page has been sent.
export const maxDuration = 60;

export function generateMetadata(): Metadata {
  return blogIndexMetadata("en");
}

export default function BlogIndexPage() {
  after(proofreadOnceAfterDeploy);
  return <BlogIndex language="en" />;
}
