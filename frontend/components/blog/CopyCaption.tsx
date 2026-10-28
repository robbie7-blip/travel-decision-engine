"use client";

// The Instagram caption with a copy button (app/admin/instagram).

import { useState } from "react";

export function CopyCaption({ caption }: { caption: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <textarea
        readOnly
        value={caption}
        rows={Math.min(18, caption.split("\n").length + 1)}
        className="font-ui"
        style={{ width: "100%", padding: 12, fontSize: 14, lineHeight: 1.5, border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg-panel)", color: "var(--ink)" }}
      />
      <button
        type="button"
        className="font-ui btn-primary"
        style={{ minHeight: 44, padding: "0 18px", fontSize: 13, marginTop: 8 }}
        onClick={() => {
          navigator.clipboard
            ?.writeText(caption)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? "Copied" : "Copy caption"}
      </button>
    </div>
  );
}
