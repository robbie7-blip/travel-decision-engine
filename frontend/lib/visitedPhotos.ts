// Photos attached to a place you've been. Device-local, in IndexedDB.
//
// Deliberately NOT uploaded anywhere. Two reasons, and the second is the
// one that decided it:
//
// 1. Cost. Blob storage is metered, and holiday photos are the one kind of
//    file people add without limit. This feature can exist and cost nothing
//    to run, which is the difference between shipping it and not.
// 2. It matches how the tracker already works. Marking a country visited
//    needs no account (see lib/localVisited.ts); signing in is an optional
//    sync upgrade, not the price of entry. A photo feature that demanded an
//    account would be the first part of this page to do so.
//
// The tradeoff is real and the UI has to say it out loud: a photo added on
// a phone will not appear on a laptop, and clearing site data deletes it.
// That is a fair trade for a private scrapbook and a bad one for a backup,
// so the copy calls it "on this device" everywhere rather than implying
// these are safe somewhere.
//
// localStorage is not an option here: it is a ~5MB string store shared with
// the visited list itself, and two photos would evict it. IndexedDB holds
// Blobs natively, is measured in hundreds of MB, and keeps the bytes out of
// the JSON we serialise on every visited-list write.

/** Downscaled before storage, not stored at camera resolution - a modern
 * phone photo is several MB and this is a thumbnail-sized memory, not an
 * archive. Long edge in CSS pixels. */
const MAX_EDGE_PX = 1400;
const JPEG_QUALITY = 0.82;

/** A cap, so one enthusiastic afternoon can't fill the origin's quota and
 * start failing writes for the visited list itself. */
export const MAX_PHOTOS_PER_PLACE = 6;
export const MAX_PHOTO_INPUT_BYTES = 12 * 1024 * 1024;

const DB_NAME = "decide-visited-photos";
const DB_VERSION = 1;
const STORE = "photos";
/** Photos are indexed by place so a country page can load only its own. */
const PLACE_INDEX = "byPlace";

export interface VisitedPhoto {
  id: string;
  /** Country code, or `${code}:${pinId}` when it belongs to a specific pin. */
  placeKey: string;
  blob: Blob;
  addedAt: number;
  caption?: string;
}

/** What the UI actually renders: the same record with an object URL instead
 * of a Blob. Revoke it when the component unmounts - see revokePhotoUrls. */
export interface VisitedPhotoView {
  id: string;
  placeKey: string;
  url: string;
  addedAt: number;
  caption?: string;
}

export function placeKeyFor(code: string, pinId?: string): string {
  return pinId ? `${code}:${pinId}` : code;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(PLACE_INDEX, "placeKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function run<T>(store: IDBObjectStore, request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** Re-encodes a picked file down to MAX_EDGE_PX as JPEG.
 *
 * imageOrientation: "from-image" matters more than it looks: a phone photo
 * is very often stored rotated with an EXIF flag, and drawing it to a
 * canvas without honouring that flag saves it sideways. Safari lagged on
 * the options argument, so the bare call is the fallback - a possibly
 * rotated photo beats no photo. Same handling as the Ask a Local uploader
 * in components/TripQA.tsx. */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() =>
    createImageBitmap(file)
  );
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) throw new Error("could not encode image");
  return blob;
}

export async function addVisitedPhoto(placeKey: string, file: File, caption?: string): Promise<VisitedPhoto> {
  const blob = await downscale(file);
  const record: VisitedPhoto = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    placeKey,
    blob,
    addedAt: Date.now(),
    ...(caption ? { caption } : {}),
  };
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await run(tx.objectStore(STORE), tx.objectStore(STORE).add(record));
  } finally {
    db.close();
  }
  return record;
}

export async function listVisitedPhotos(placeKey: string): Promise<VisitedPhotoView[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index(PLACE_INDEX);
    const rows = await run(tx.objectStore(STORE), index.getAll(placeKey) as IDBRequest<VisitedPhoto[]>);
    return rows
      .sort((a, b) => a.addedAt - b.addedAt)
      .map((row) => ({
        id: row.id,
        placeKey: row.placeKey,
        url: URL.createObjectURL(row.blob),
        addedAt: row.addedAt,
        caption: row.caption,
      }));
  } finally {
    db.close();
  }
}

/** How many photos each place has, without decoding any of them - so a page
 * listing many countries can show a count per row cheaply. */
export async function countVisitedPhotos(): Promise<Record<string, number>> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const keys = await run(store, store.index(PLACE_INDEX).getAllKeys() as IDBRequest<IDBValidKey[]>);
    const counts: Record<string, number> = {};
    for (const key of keys) {
      const placeKey = String(key);
      counts[placeKey] = (counts[placeKey] ?? 0) + 1;
    }
    return counts;
  } finally {
    db.close();
  }
}

export async function deleteVisitedPhoto(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await run(tx.objectStore(STORE), tx.objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

/** Removes every photo for a place. Called when a country is un-marked, so
 * un-visiting somewhere doesn't leave its photos orphaned in the database
 * with no UI that can ever reach them again. */
export async function deletePhotosForPlace(placeKey: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const keys = await run(
      store,
      store.index(PLACE_INDEX).getAllKeys(placeKey) as IDBRequest<IDBValidKey[]>
    );
    for (const key of keys) store.delete(key);
  } finally {
    db.close();
  }
}

export function revokePhotoUrls(photos: VisitedPhotoView[]): void {
  for (const photo of photos) URL.revokeObjectURL(photo.url);
}
