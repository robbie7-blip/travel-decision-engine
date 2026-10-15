"use client";

// Group voting on a trip's lines (lib/tripVotes.ts, app/api/trip-votes).
//
// Hidden on a trip nobody has voted on, so planning alone looks the same
// as before. It appears when the trip is opened from an "ask friends to
// vote" link (?vote=1), or as soon as anyone has voted.

import { useCallback, useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import type { VoteSummary } from "@/lib/tripVotes";

const EMPTY: VoteSummary = { counts: {}, mine: {}, voters: 0 };

export function useTripVotes(jobId: string) {
  const [summary, setSummary] = useState<VoteSummary>(EMPTY);
  const [invited, setInvited] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSummary(EMPTY);
    setInvited(new URLSearchParams(window.location.search).get("vote") === "1");
    fetch(`/api/trip-votes?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((data: VoteSummary) => {
        if (!cancelled && data && typeof data === "object" && data.counts) setSummary(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const vote = useCallback(
    async (ref: string, value: 1 | -1) => {
      // Pressing the vote you already gave takes it back.
      const next = summary.mine[ref] === value ? 0 : value;
      setFailed(false);
      try {
        const response = await fetch("/api/trip-votes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, ref, vote: next }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error();
        setSummary(data as VoteSummary);
      } catch {
        setFailed(true);
      }
    },
    [jobId, summary.mine]
  );

  return { summary, visible: invited || summary.voters > 0, enable: () => setInvited(true), vote, failed };
}

export function ItemVotes({
  voteRef,
  summary,
  onVote,
  t,
}: {
  voteRef: string;
  summary: VoteSummary;
  onVote: (ref: string, value: 1 | -1) => void;
  t: Dictionary;
}) {
  const count = summary.counts[voteRef] ?? { up: 0, down: 0 };
  const mine = summary.mine[voteRef];
  return (
    <div className="item-votes font-ui no-print" role="group" aria-label={t.result.votes.label}>
      <button type="button" className="item-vote" aria-pressed={mine === 1} onClick={() => onVote(voteRef, 1)}>
        <span aria-hidden>👍</span> {t.result.votes.up}
        {count.up > 0 && <span className="item-vote-count">{count.up}</span>}
      </button>
      <button type="button" className="item-vote" aria-pressed={mine === -1} onClick={() => onVote(voteRef, -1)}>
        <span aria-hidden>👎</span> {t.result.votes.down}
        {count.down > 0 && <span className="item-vote-count">{count.down}</span>}
      </button>
    </div>
  );
}

/** "Ask friends to vote": the trip's link with ?vote=1, shared through the
 * phone's share sheet where there is one, copied where there is not. */
export function AskToVoteButton({ jobId, onShared, t }: { jobId: string; onShared: () => void; t: Dictionary }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/trip/${jobId}?vote=1`;
    onShared();
    try {
      if (navigator.share) {
        await navigator.share({ url, title: t.result.votes.shareTitle });
        return;
      }
    } catch {
      // Dismissed, or not allowed here: fall through to copying.
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 4000);
    } catch {
      window.prompt(t.result.votes.copyPrompt, url);
    }
  }

  return (
    <button type="button" onClick={() => void share()} className="font-ui no-print trip-action">
      <span aria-hidden>👥</span> {copied ? t.result.votes.copied : t.result.votes.share}
    </button>
  );
}
