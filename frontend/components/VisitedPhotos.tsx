"use client";

// Photos for one place. Used both on the visited page (a grid per country)
// and at the end of a finished trip.
//
// Everything here is device-local by design - see lib/visitedPhotos.ts for
// why. The one thing this component must never do is imply otherwise, so
// the "on this device" line is not optional chrome: it is the honest
// version of what pressing the button does.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addVisitedPhoto,
  deleteVisitedPhoto,
  listVisitedPhotos,
  revokePhotoUrls,
  MAX_PHOTOS_PER_PLACE,
  MAX_PHOTO_INPUT_BYTES,
  type VisitedPhotoView,
} from "@/lib/visitedPhotos";
import type { Dictionary } from "@/lib/i18n";

export function VisitedPhotos({
  placeKey,
  t,
  compact = false,
}: {
  placeKey: string;
  t: Dictionary;
  /** The trip-page version: smaller thumbs, no heading of its own. */
  compact?: boolean;
}) {
  const [photos, setPhotos] = useState<VisitedPhotoView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Held in a ref as well as state so the unmount cleanup revokes the URLs
  // that actually exist at that moment rather than the ones from the render
  // the effect closed over. Leaking object URLs keeps the decoded image in
  // memory for the life of the document.
  const current = useRef<VisitedPhotoView[]>([]);

  const load = useCallback(async () => {
    try {
      const next = await listVisitedPhotos(placeKey);
      revokePhotoUrls(current.current);
      current.current = next;
      setPhotos(next);
    } catch {
      // A browser with IndexedDB blocked (private mode in some browsers,
      // storage disabled) is a no-photos browser, not a broken page.
      current.current = [];
      setPhotos([]);
    }
  }, [placeKey]);

  useEffect(() => {
    void load();
    return () => {
      revokePhotoUrls(current.current);
      current.current = [];
    };
  }, [load]);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared immediately so picking the same file twice in a row still
    // fires a change event.
    event.target.value = "";
    if (!file) return;

    if (photos.length >= MAX_PHOTOS_PER_PLACE) {
      setError(t.visited.photos.tooMany.replace("{max}", String(MAX_PHOTOS_PER_PLACE)));
      return;
    }
    if (file.size > MAX_PHOTO_INPUT_BYTES) {
      setError(t.visited.photos.tooLarge);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await addVisitedPhoto(placeKey, file);
      await load();
    } catch {
      setError(t.visited.photos.failed);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteVisitedPhoto(id);
      await load();
    } catch {
      setError(t.visited.photos.failed);
    }
  }

  const thumb = compact ? 72 : 96;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {photos.map((photo) => (
          <div key={photo.id} style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt=""
              style={{
                width: thumb,
                height: thumb,
                objectFit: "cover",
                borderRadius: 8,
                border: "1px solid var(--line)",
                display: "block",
              }}
            />
            <button
              type="button"
              onClick={() => onDelete(photo.id)}
              aria-label={t.visited.photos.remove}
              className="font-ui photo-remove"
            >
              ×
            </button>
          </div>
        ))}

        {photos.length < MAX_PHOTOS_PER_PLACE && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={onPick}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="font-ui photo-add"
              style={{ width: thumb, height: thumb }}
            >
              {busy ? t.visited.photos.adding : t.visited.photos.add}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="font-ui" style={{ fontSize: 12, color: "var(--infeasible)", marginTop: 8 }}>
          {error}
        </div>
      )}
      {photos.length > 0 && (
        <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8 }}>
          {t.visited.photos.deviceOnly}
        </div>
      )}
    </div>
  );
}
