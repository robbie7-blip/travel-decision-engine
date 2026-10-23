"use client";

// The site header on blog pages. Switching language goes to the other
// language's blog index: posts are written per language, so the same
// address in the other language usually does not exist.

import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { TRANSLATIONS } from "@/lib/i18n";
import { blogPath } from "@/lib/blogPaths";
import type { Language } from "@/lib/types";

export function BlogHeader({ language, contextLink }: { language: Language; contextLink?: { href: string; label: string } }) {
  const router = useRouter();
  return (
    <SiteHeader
      language={language}
      onLanguageChange={(next) => router.push(blogPath(next))}
      t={TRANSLATIONS[language]}
      contextLink={contextLink}
      maxWidth={1450}
    />
  );
}
