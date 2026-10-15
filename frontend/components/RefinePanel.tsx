"use client";

// What the page shows while a pushback runs.
//
// It used to be one grey line under the input ("thinking…") for the whole
// wait, so a pushback looked like nothing was happening. Now the question
// stays on screen, the answer appears the moment the worker has it
// (progress.answer, published before the changed lines are checked), and
// the steps after it come from the stage the worker reports - see
// refineSteps in lib/stageSteps.ts.
//
// The answer is rendered as text, never as HTML: it is model output.

import { useEffect, useRef } from "react";
import { ThinkingMark } from "./ThinkingMark";
import { refineSteps } from "@/lib/stageSteps";
import type { Dictionary } from "@/lib/i18n";
import type { JobProgress } from "@/lib/jobs";

export function RefinePanel({
  question,
  progress,
  waitingLabel,
  t,
}: {
  question?: string;
  progress?: JobProgress;
  /** The job-status line (queued, starting), for before the worker has
   * published anything of its own. */
  waitingLabel?: string;
  t: Dictionary;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const copy = t.result.refine;
  const steps = refineSteps(progress);
  const answer = progress?.answer?.trim();
  const changes = progress?.changes;

  // Into view once, when it opens: on a phone the keyboard closing can
  // leave the input, and everything under it, off screen.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);

  const label = (id: (typeof steps)[number]["id"]): string => {
    if (id !== "updating" || typeof changes !== "number") return copy[id];
    if (changes < 0) return copy.updatingRewrite;
    if (changes === 0) return copy.updatingNone;
    if (changes === 1) return copy.updatingOne;
    return copy.updatingMany.replace("{n}", String(changes));
  };

  return (
    <div ref={ref} className="refine-panel">
      {question && (
        <div className="font-ui refine-panel-question">
          {t.result.pushbackYouAsked}: <span className="refine-panel-question-text">{question}</span>
        </div>
      )}

      <div aria-live="polite">
        {answer ? (
          <div className="refine-panel-answer">
            <div className="font-ui refine-panel-answer-label">{copy.answer}</div>
            <div className="refine-panel-answer-text">{answer}</div>
          </div>
        ) : (
          <div className="font-ui thinking-row refine-panel-thinking">
            <ThinkingMark size={20} />
            <span>{progress ? copy.thinking : waitingLabel ?? copy.thinking}</span>
          </div>
        )}
      </div>

      <ol className="trip-stages font-ui refine-panel-steps" aria-label={t.trip.stages.label}>
        {steps
          .filter((step) => step.id !== "thinking")
          .map((step) => (
            <li
              key={step.id}
              className="trip-stage"
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <span className="trip-stage-mark" aria-hidden>
                {step.state === "done" ? "✓" : ""}
              </span>
              <span className="trip-stage-text">
                {label(step.id)}
                {step.state === "done" && <span className="sr-only">, {t.trip.stages.doneLabel}</span>}
              </span>
            </li>
          ))}
      </ol>
    </div>
  );
}
