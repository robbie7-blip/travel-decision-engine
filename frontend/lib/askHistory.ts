// Saved Ask a Local conversations, so a question you asked last night is
// still there this morning.
//
// Client-side only, in localStorage, same tradeoff as lib/recentTrips.ts:
// no accounts, no server state, per-browser, and clearing site data loses
// it. That is deliberate rather than a shortcut. A conversation here is
// somebody asking whether a neighbourhood is safe to walk through at
// night, whether a pharmacy will have their prescription, how much to tip
// so they do not stand out - and keeping that on a server, attached to an
// identity, would be a worse product than one that forgets.
//
// THE PHOTOS ARE NOT IN HERE, and the type system is what guarantees it
// rather than anyone remembering to strip them. A question can carry a
// photo of a minibar card, a menu, a prescription, a passport page; the
// promise this feature makes (see TripQAImage in lib/tripQA.ts) is that it
// goes to the model with the request and is gone. A history feature is
// exactly where that promise gets broken by accident, so SavedAskTurn has
// no field a photo could go in: writing one is a type error, not an
// oversight. What IS kept is that there WAS one, so reopening a thread
// does not silently rewrite what was asked.

import type { LocalVoice, TripQAMessage, TripQARole } from "./tripQA";
import { LOCAL_VOICES } from "./tripQA";

const STORAGE_KEY = "decide:askChats";

/** How many conversations are kept. Past this the oldest is dropped.
 *
 * Twenty rather than everything: this is a side panel on a phone, not an
 * archive, and the list stops being browsable long before localStorage
 * stops coping. */
export const MAX_ASK_CHATS = 20;

/** How long a title can get before it is cut. A title is the first thing
 * asked, and a question is a sentence, so this is about the length of one
 * line in the list rather than a storage limit. */
const MAX_TITLE_LENGTH = 72;

/** One turn, as stored. NOT TripQAMessage: no `images`, by construction.
 * See the note at the top of the file. */
export interface SavedAskTurn {
  role: TripQARole;
  content: string;
  /** That a photo was attached to this question. Never the photo. */
  hadPhoto?: boolean;
}

export interface SavedAskChat {
  id: string;
  /** The trip this conversation is about, when it is about one.
   *
   * WHY A CONVERSATION HAS A SCOPE. Ask a Local renders in two places: on
   * /ask, where a question stands on its own, and inside a generated
   * itinerary, where the same component is handed that trip's dates,
   * cities and party as context - so the answers are about THAT trip and
   * frequently make no sense without it ("the second one is closer to your
   * hotel"). Saving both into one list would mean reopening such a thread
   * from /ask, with the trip it was grounded in gone.
   *
   * So a conversation belongs to where it happened: absent for /ask, the
   * job id for a trip. A trip's conversations are only ever listed on that
   * trip's own page, and /ask lists only the ones that stand alone. */
  tripId?: string;
  /** The first question asked, cut to one line. Stored as the traveler's
   * own words rather than a translated label, so it still reads correctly
   * after they switch the interface language - the empty case is filled in
   * by the UI from TRANSLATIONS instead. */
  title: string;
  /** Who was answering. Restored with the thread, because an answer in a
   * particular voice beside a different face is a different answer. */
  voice: LocalVoice | null;
  turns: SavedAskTurn[];
  updatedAt: number;
}

/** A new conversation's id.
 *
 * crypto.randomUUID is unavailable on an insecure origin (and on older
 * Safari), and this is called on the first keystroke of a conversation, so
 * it cannot be allowed to throw - the fallback only has to be unique
 * within one browser's list of twenty. */
export function newAskChatId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    /* fall through */
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** The conversation, with every photo left behind. */
export function toSavedTurns(messages: TripQAMessage[]): SavedAskTurn[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.images && message.images.length > 0 ? { hadPhoto: true as const } : {}),
  }));
}

/** Back into the live thread. The photo cannot come back, so the turn
 * returns without one - and TripQA shows a line saying so, rather than
 * letting the question read as though it never had one. */
export function toLiveMessages(turns: SavedAskTurn[]): TripQAMessage[] {
  return turns.map((turn) => ({ role: turn.role, content: turn.content }));
}

/** The first question, on one line. Empty when the first turn was a photo
 * with nothing typed, which the UI labels instead. */
export function askChatTitle(turns: SavedAskTurn[]): string {
  const first = turns.find((turn) => turn.role === "user" && turn.content.trim() !== "");
  if (!first) return "";
  const line = first.content.trim().replace(/\s+/g, " ");
  if (line.length <= MAX_TITLE_LENGTH) return line;
  // Cut at a space rather than mid-word where there is one close enough to
  // the limit, so the list does not read "Is it safe to walk aro...".
  const cut = line.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > MAX_TITLE_LENGTH - 16 ? cut.slice(0, lastSpace) : cut;
  // Trailing punctuation goes too, or the cut lands as "after midnight,..."
  return `${kept.replace(/[\s,;:.!?-]+$/, "")}...`;
}

function isSavedTurn(value: unknown): value is SavedAskTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Partial<SavedAskTurn>;
  return (
    (turn.role === "user" || turn.role === "assistant") &&
    typeof turn.content === "string" &&
    (turn.hadPhoto === undefined || typeof turn.hadPhoto === "boolean")
  );
}

/** Whether a stored entry is shaped like one.
 *
 * Checked for the same reason lib/recentTrips.ts checks its own: this list
 * outlives deploys, nothing versions it, and it renders in a panel. An
 * entry from an older build whose `turns` is missing would throw during
 * render, on every load, until the traveler clears site data - and they
 * would have no way to know why.
 *
 * A stored photo is treated as a corrupt entry rather than tidied away:
 * nothing in this app can write one, so an entry carrying one came from
 * somewhere that did not go through toSavedTurns, and the honest response
 * is to not load it. */
function isSavedChat(value: unknown): value is SavedAskChat {
  if (!value || typeof value !== "object") return false;
  const chat = value as Partial<SavedAskChat> & { turns?: unknown };
  if (typeof chat.id !== "string" || chat.id.length === 0) return false;
  if (typeof chat.title !== "string") return false;
  if (typeof chat.updatedAt !== "number" || !Number.isFinite(chat.updatedAt)) return false;
  if (chat.voice !== null && !LOCAL_VOICES.includes(chat.voice as LocalVoice)) return false;
  // Checked, because this decides WHERE a conversation is listed: a
  // tripId of the wrong type would compare unequal to both undefined and
  // any real job id, which is harmless, but one that is an empty string
  // would be written as absent and read as a trip. Dropping the entry is
  // the honest answer to "which trip is this about".
  if (chat.tripId !== undefined && (typeof chat.tripId !== "string" || chat.tripId === "")) return false;
  if (!Array.isArray(chat.turns) || chat.turns.length === 0) return false;
  if (!chat.turns.every(isSavedTurn)) return false;
  if (chat.turns.some((turn) => "images" in (turn as object))) return false;
  return true;
}

/** The conversations belonging to one place.
 *
 * `tripId` undefined means the standalone /ask list, which is NOT "all of
 * them": a trip's thread is only listed on that trip. See tripId on
 * SavedAskChat. */
/** Every stored conversation, whatever it belongs to, newest first.
 *
 * The scope filter is applied by getAskChats on top of this. Writing needs
 * the unfiltered list: the cap and the stored value are global, so writing
 * back one scope's list would delete the other's. */
function allAskChats(): SavedAskChat[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (
      parsed
        .filter(isSavedChat)
        // Newest first, and sorted on read rather than trusted: the write
        // path keeps this order, but a value that got here another way (an
        // older build, a second tab that wrote while this one was open) is
        // not bound by it.
        .sort((a, b) => b.updatedAt - a.updatedAt)
        // Capped on read as well as on write, for the same reason.
        .slice(0, MAX_ASK_CHATS)
    );
  } catch {
    return [];
  }
}

export function getAskChats(tripId?: string): SavedAskChat[] {
  return allAskChats().filter((chat) => chat.tripId === tripId);
}

/** Writes the list, shedding the oldest conversations if the browser says
 * there is no room.
 *
 * An answer runs to a few thousand characters and twenty conversations of
 * them is a few hundred KB, which fits the usual 5MB budget several times
 * over - but the budget is shared with everything else this origin stores,
 * a private window can report a far smaller one, and a quota failure
 * throws. Dropping the oldest and trying again is what a history list
 * should do; the alternative is the newest conversation being the one that
 * fails to save. */
function write(chats: SavedAskChat[]): boolean {
  if (typeof window === "undefined") return false;
  let candidate = chats;
  while (candidate.length > 0) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
      return true;
    } catch {
      candidate = candidate.slice(0, -1);
    }
  }
  try {
    // Nothing fits, so leave nothing behind claiming to be the history.
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore - see above */
  }
  return false;
}

/** Saves (or updates) one conversation, moving it to the front.
 *
 * Returns what was stored, so the caller can render the list it will see
 * on the next load rather than guessing. A conversation with no finished
 * exchange in it is not saved at all: a thread holding one question and an
 * empty assistant placeholder is what exists for the second between
 * pressing send and the first word arriving, and a list full of those is
 * worse than no list. */
export function saveAskChat(input: {
  id: string;
  voice: LocalVoice | null;
  messages: TripQAMessage[];
  /** Where this conversation happened. See tripId on SavedAskChat. */
  tripId?: string;
}): SavedAskChat | null {
  if (typeof window === "undefined") return null;
  const turns = toSavedTurns(input.messages).filter(
    // An assistant turn that is still empty has not been said yet.
    (turn) => turn.role === "user" || turn.content.trim() !== ""
  );
  if (!turns.some((turn) => turn.role === "assistant")) return null;

  const chat: SavedAskChat = {
    id: input.id,
    title: askChatTitle(turns),
    voice: input.voice,
    turns,
    updatedAt: Date.now(),
    ...(input.tripId ? { tripId: input.tripId } : {}),
  };
  // Read ALL of them to write, not just this scope's: the cap and the
  // stored value are global, so writing back only one scope's list would
  // delete every conversation belonging to the other.
  const next = [chat, ...allAskChats().filter((existing) => existing.id !== chat.id)].slice(0, MAX_ASK_CHATS);
  return write(next) ? chat : null;
}

export function deleteAskChat(id: string): void {
  if (typeof window === "undefined") return;
  // Across every scope, for the same reason saveAskChat writes all of
  // them: the stored list is one list.
  write(allAskChats().filter((chat) => chat.id !== id));
}

export function clearAskChats(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best effort, same as every other write here */
  }
}
