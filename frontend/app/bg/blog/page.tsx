import type { Metadata } from "next";
import { BlogIndex, blogIndexMetadata } from "@/components/blog/BlogIndex";

// The Bulgarian blog. Read from Postgres on each request: posts are
// published from /admin/blog at any time.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function generateMetadata(): Metadata {
  return blogIndexMetadata("bg");
}

export default function BlogIndexPage() {
  return <BlogIndex language="bg" />;
}
