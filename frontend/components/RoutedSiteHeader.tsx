"use client";

// SiteHeader for server-rendered pages, whose language lives in the URL
// (?lang=bg) rather than in client state: switching language navigates.

import { usePathname, useRouter } from "next/navigation";
import { SiteHeader } from "./SiteHeader";
import { TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function RoutedSiteHeader({ language, contextLink }: { language: Language; contextLink?: { href: string; label: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <SiteHeader
      language={language}
      onLanguageChange={(next) => router.push(next === "bg" ? `${pathname}?lang=bg` : pathname)}
      t={TRANSLATIONS[language]}
      contextLink={contextLink}
      maxWidth={1450}
    />
  );
}
