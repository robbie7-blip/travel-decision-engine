"use client";

// Zero-render client component whose only job is to set the owner-UI flag
// (see lib/adminUi.ts). Exists so SERVER-rendered admin pages can set it
// too: the flag lives in localStorage, so a server component can't write it
// itself, which meant /admin/stats and /admin/feedback - the two most
// natural admin pages to open - silently failed to enable the owner-only
// controls elsewhere in the app. Dropping this in makes every admin page
// behave the same, rather than the flag depending on which one you happened
// to visit.

import { useEffect } from "react";
import { markAdminUi } from "@/lib/adminUi";

export function MarkAdminUi() {
  useEffect(() => {
    markAdminUi();
  }, []);
  return null;
}
