"use client";

// A few lines of a real plan, right under the hero.
//
// Only ever a trip that exists: the one an admin set as the demo, or else
// the newest entry in the public "Real examples" gallery (see
// app/api/demo-trip/route.ts). When there is neither, this renders
// nothing - the alternative would be an invented example on a product
// whose whole claim is that it does not invent things.

import Link from "next/link";
import type { DemoPreview } from "@/lib/demoPreview";
import { trackHomeEvent } from "@/lib/homeEvents";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import { ConfidenceTag } from "./ui";

export interface DemoWithPreview {
  jobId: string;
  destinations: string[];
  preview?: DemoPreview;
}

const LOCALE: Record<Language, string> = { en: "en-GB", bg: "bg-BG" };

function shortDate(iso: string, language: Language): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(LOCALE[language], { day: "numeric", month: "short" }).format(date);
}

/** Back up to the bar, with the cursor in the destination field. */
function planYourOwn() {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  // preventScroll: the scroll above is already taking the page there, and
  // a focus that scrolls on its own would jump instead of glide.
  document.querySelector<HTMLInputElement>(".hero-search input")?.focus({ preventScroll: true });
}

export function ExampleTrip({ demo, t, language }: { demo: DemoWithPreview; t: Dictionary; language: Language }) {
  const preview = demo.preview;
  if (!preview || preview.lines.length === 0) return null;
  const copy = t.demo;
  const where = demo.destinations.join(" · ");
  const title =
    preview.days === 1
      ? copy.titleOne.replace("{destination}", where)
      : copy.titleMany.replace("{destination}", where).replace("{days}", String(preview.days));
  const href = `/trip/${demo.jobId}`;

  return (
    <section className="example-trip" aria-labelledby="example-trip-title">
      <div style={{ maxWidth: 1550, margin: "0 auto" }}>
        <div className="example-trip-grid">
          <div className="example-trip-copy">
            <p className="example-trip-eyebrow font-ui">{copy.eyebrow}</p>
            <h2 id="example-trip-title" className="example-trip-title font-display">
              {title}
            </h2>
            <p className="example-trip-trust">
              {copy.trust.replace("{percent}", String(preview.trustPercent))}
            </p>
            <div className="example-trip-actions font-ui">
              <Link href={href} className="example-trip-open" onClick={() => trackHomeEvent("example_opened")}>
                {copy.open} <span aria-hidden>→</span>
              </Link>
              <button type="button" className="example-trip-yours" onClick={planYourOwn}>
                {copy.planYours} <span aria-hidden>↑</span>
              </button>
            </div>
          </div>

          {/* What the plan actually looks like: the same tags, in the same
              place, as on the trip page. Not a link of its own - the
              button beside it is the way in, once. */}
          <div className="example-trip-card">
            <div className="example-trip-card-head font-ui">
              <span>
                {copy.dayHeading
                  .replace("{day}", String(preview.day))
                  .replace("{date}", shortDate(preview.dayDate, language))}
              </span>
              <span className="example-trip-score">
                {preview.trustPercent}% {t.result.trustScoreLabel}
              </span>
            </div>
            <ol className="example-trip-lines">
              {preview.lines.map((line, i) => (
                <li key={i} className="example-trip-line">
                  <span className="example-trip-time font-ui">{line.time}</span>
                  <span className="example-trip-line-title">{line.title}</span>
                  <ConfidenceTag tier={line.tier} label={t.tierTag[line.tier]} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
