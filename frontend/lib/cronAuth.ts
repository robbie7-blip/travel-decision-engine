// Vercel Cron calls carry `Authorization: Bearer $CRON_SECRET`. Anything
// else is refused - and so is everything while CRON_SECRET is unset, since
// an open URL that sends email on demand is not a thing to leave lying
// around.

import { timingSafeEqual } from "node:crypto";

export function isCronRequest(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
