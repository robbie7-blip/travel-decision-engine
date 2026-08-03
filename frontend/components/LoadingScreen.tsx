/** Shown while a trip (or one side of a comparison) is generating — replaces
 * the old bare status text with a spinner + card so the wait feels designed
 * rather than stalled. `message` is the live rotating status line from
 * useJobStatusMessage; this component is purely presentational. */
export function LoadingScreen({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        padding: "48px 24px",
        background: "var(--bg-panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "3px solid var(--line)",
          borderTopColor: "var(--accent-1)",
          borderRightColor: "var(--accent-2)",
          animation: "decide-spin 0.8s linear infinite",
        }}
      />
      <div
        className="font-mono"
        style={{ fontSize: 14, color: "var(--ink-dim)", textAlign: "center" }}
      >
        {message}
      </div>
    </div>
  );
}
