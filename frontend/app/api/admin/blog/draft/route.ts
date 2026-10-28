// "Draft with Claude" on /admin/blog: a topic in, a first draft out, for
// the editor to fill in. Saves nothing. Behind the admin password.

import { NextRequest, NextResponse } from "next/server";
import { createAnthropicClient, isMissingWorkspaceIdError } from "@/lib/anthropicClient";
import { findCoverPhoto, writeDraft, type DraftKind } from "@/lib/blogDraft";
import { allowedOriginsFor, isCrossOriginRequest } from "@/lib/sameOrigin";
import { getSiteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const KINDS = new Set<DraftKind>(["news", "destination", "story", "tip", "mistakes"]);

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request.headers, allowedOriginsFor(request.url, getSiteUrl()))) {
    return NextResponse.json({ detail: "Request must come from the site itself." }, { status: 403 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ detail: "ANTHROPIC_API_KEY is not set on this deployment." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 500) : "";
  const kind = KINDS.has(body?.kind as DraftKind) ? (body!.kind as DraftKind) : null;
  const language = body?.language === "bg" ? "bg" : "en";
  if (!topic || !kind) return NextResponse.json({ detail: "A topic and a kind (news, destination or story) are needed." }, { status: 400 });

  try {
    // 55s: inside the function's own 60, so a slow draft fails with a
    // sentence rather than a cut connection.
    const client = createAnthropicClient({ apiKey, timeout: 170_000, maxRetries: 0 });
    const draft = await writeDraft(client, { kind, topic, language, today: new Date().toISOString().slice(0, 10) });
    if (!draft) return NextResponse.json({ detail: "The draft came back unusable. Try again, or a narrower topic." }, { status: 502 });
    const cover = await findCoverPhoto(draft.imageQuery || draft.destinations[0] || topic, process.env.PEXELS_API_KEY);
    return NextResponse.json({ draft, cover });
  } catch (e) {
    console.warn("[admin/blog/draft]", e instanceof Error ? e.message.slice(0, 300) : e);
    const detail = isMissingWorkspaceIdError(e)
      ? "The API key needs ANTHROPIC_WORKSPACE_ID set."
      : e instanceof Error && /timeout|timed out/i.test(e.message)
        ? "The draft took too long. Try a narrower topic, or a destination or story instead of news."
        : "Could not write a draft right now.";
    return NextResponse.json({ detail }, { status: 502 });
  }
}
