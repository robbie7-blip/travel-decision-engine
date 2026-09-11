// Which request fields a given model will actually accept.
//
// This exists because of one specific, total failure mode. The day calls
// send `output_config: { effort: ... }`, and not every model accepts that
// field - a model that rejects it returns 400. Since every day call carries
// the same field, picking the wrong DAY_MODEL doesn't degrade the trip, it
// fails EVERY day call and takes the whole generation down.
//
// And DAY_MODEL is an env var whose entire purpose is to invite that change:
// "set DAY_MODEL to a faster one to trade some prose polish for a materially
// shorter phase 2". The obvious faster model is Haiku 4.5, which is exactly
// one of the models that rejects effort. So the dial as shipped pointed at a
// broken configuration, and nothing in the code or the comment said so.
//
// Run: npm run test:model-caps

/** Whether `model` accepts `output_config.effort`.
 *
 * Deliberately an ALLOWLIST, because the two mistakes are not the same
 * size. Omitting effort from a model that would have accepted it costs a
 * little speed or polish and nothing else. SENDING it to a model that
 * rejects it fails the generation outright. So an unrecognised model - a
 * future release, a typo - gets the safe treatment.
 *
 * Effort is accepted on the Opus 4.5+ families, Sonnet 5, Sonnet 4.6, and
 * the Fable/Mythos families. It is rejected on Haiku 4.5 and Sonnet 4.5.
 * The two explicit exclusions come first so they win over the family match
 * below (a "sonnet" substring would otherwise sweep up sonnet-4-5). */
export function modelSupportsEffort(model: string): boolean {
  if (typeof model !== "string") return false;
  const m = model.toLowerCase();
  if (m.includes("haiku")) return false;
  if (m.includes("sonnet-4-5")) return false;
  return (
    m.includes("opus") ||
    m.includes("fable") ||
    m.includes("mythos") ||
    m.includes("sonnet-5") ||
    m.includes("sonnet-4-6")
  );
}
