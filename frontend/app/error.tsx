"use client";

// The error boundary.
//
// Like app/not-found.tsx, this did not exist, so an unhandled render
// error produced Next's default error screen - and in production that is
// a bare page reading "Application error: a client-side exception has
// occurred", which tells a traveller nothing except that the thing they
// were in the middle of is gone.
//
// It has to be a client component and it has to take `reset`: that is the
// contract Next defines for error.tsx, and `reset` re-renders the segment
// without a full page load, which is the difference between "try again"
// costing nothing and costing the form they had half filled in.
//
// The furniture is shared with the 404 (components/DeadEndView.tsx); only
// the words and the retry button differ.

import { useEffect } from "react";
import { DeadEndView } from "@/components/DeadEndView";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest is the only handle on what actually broke: Next replaces
    // the message with a generic one in production, and logs the real
    // stack server-side under this id. Without printing it here, a report
    // of "it crashed" has nothing to join it to.
    console.error("Unhandled error", error.digest ?? "", error);
  }, [error]);

  return <DeadEndView kind="error" onRetry={reset} />;
}
