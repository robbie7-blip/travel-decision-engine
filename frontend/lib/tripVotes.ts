// Thumbs up and down on a trip's lines, for a group deciding together.
//
// One Redis hash per trip, `votes:{jobId}`, one field per voter per line:
// "d2.3|<voter>" -> "1" or "-1". A voter is an anonymous id in a cookie
// (no account needed - the people voting are the friends a link was sent
// to), so voting twice on a line changes the vote rather than adding one.
//
// The hash lives exactly as long as the trip (ttlForJob) and is capped in
// size, so an open endpoint cannot be used to grow Redis without bound.
//
// Run: npm run test:trip-votes

export const VOTER_COOKIE_NAME = "decide_voter";
export const MAX_VOTE_FIELDS = 2000;

export function votesKey(jobId: string): string {
  return `votes:${jobId}`;
}

/** "d2.3": day 2, the third line. */
export function voteRef(day: number, index: number): string {
  return `d${day}.${index + 1}`;
}

const REF = /^d\d{1,3}\.\d{1,3}$/;
const VOTER = /^[a-f0-9-]{36}$/;

export function isVoterId(value: string | undefined | null): value is string {
  return typeof value === "string" && VOTER.test(value);
}

export function parseVote(body: unknown): { ok: true; jobId: string; ref: string; vote: -1 | 0 | 1 } | { ok: false; detail: string } {
  if (!body || typeof body !== "object") return { ok: false, detail: "Request body must be a JSON object." };
  const b = body as Record<string, unknown>;
  const jobId = typeof b.jobId === "string" ? b.jobId.trim() : "";
  if (!jobId || jobId.length > 100) return { ok: false, detail: "jobId is required." };
  if (typeof b.ref !== "string" || !REF.test(b.ref)) return { ok: false, detail: "ref must look like d2.3." };
  if (b.vote !== 1 && b.vote !== -1 && b.vote !== 0) return { ok: false, detail: "vote must be 1, -1 or 0." };
  return { ok: true, jobId, ref: b.ref, vote: b.vote };
}

export interface VoteCount {
  up: number;
  down: number;
}

export interface VoteSummary {
  counts: Record<string, VoteCount>;
  /** This voter's own vote on each line, so the page shows what they
   * pressed. */
  mine: Record<string, 1 | -1>;
  /** How many different people have voted at all. */
  voters: number;
}

/** The hash, counted. Unreadable fields are skipped, not trusted. */
export function summariseVotes(hash: Record<string, unknown> | null, voter: string | null): VoteSummary {
  const summary: VoteSummary = { counts: {}, mine: {}, voters: 0 };
  const people = new Set<string>();
  for (const [field, raw] of Object.entries(hash ?? {})) {
    const [ref, who] = field.split("|");
    if (!ref || !REF.test(ref) || !who) continue;
    const value = Number(raw);
    if (value !== 1 && value !== -1) continue;
    const count = (summary.counts[ref] ??= { up: 0, down: 0 });
    if (value === 1) count.up++;
    else count.down++;
    people.add(who);
    if (voter && who === voter) summary.mine[ref] = value;
  }
  summary.voters = people.size;
  return summary;
}
