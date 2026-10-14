"use client";

// "Type the 6-digit code from the email", shown once a sign-in email has
// been sent. Signs in THIS tab - which a link cannot do from inside
// Messenger's or Instagram's browser, where links open in Safari or
// Chrome instead. See lib/signInCode.ts.

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n";

type State = "idle" | "checking" | "error";

export function SignInCodeEntry({ email, t, onSignedIn }: { email: string; t: Dictionary; onSignedIn: () => void }) {
  const copy = t.account.signInCode;
  const [code, setCode] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function submit(value: string) {
    if (state === "checking") return;
    setState("checking");
    setError("");
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: value }),
      });
      const data = (await res.json().catch(() => null)) as { code?: string; attemptsLeft?: number } | null;
      if (res.ok) {
        onSignedIn();
        return;
      }
      setState("error");
      setError(
        data?.code === "wrong"
          ? copy.wrong.replace("{left}", String(data.attemptsLeft ?? 0))
          : data?.code === "locked"
            ? copy.locked
            : data?.code === "expired"
              ? copy.expired
              : data?.code === "rate_limited"
                ? copy.tooMany
                : t.account.genericError
      );
      setCode("");
    } catch {
      setState("error");
      setError(t.account.genericError);
    }
  }

  return (
    <form
      className="signin-code font-ui"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(code);
      }}
    >
      <label className="signin-code-label" htmlFor="signin-code-input">
        {copy.label}
      </label>
      <div className="signin-code-row">
        <input
          id="signin-code-input"
          className="signin-code-input"
          value={code}
          onChange={(e) => {
            // Digits only, as typed or pasted ("123 456" is fine). Six of
            // them is a complete code, so it goes at once - one fewer tap
            // for the person reading it off a notification.
            const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            if (digits.length === 6) void submit(digits);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          placeholder="123456"
          aria-invalid={state === "error" || undefined}
          aria-describedby={error ? "signin-code-error" : undefined}
        />
        <button type="submit" className="btn-primary signin-code-submit" disabled={state === "checking" || code.length !== 6}>
          {state === "checking" ? copy.checking : copy.submit}
        </button>
      </div>
      {error && (
        <div id="signin-code-error" className="signin-code-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
