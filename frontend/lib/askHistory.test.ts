// Saved Ask a Local conversations.
//
// The check this file exists for is the first one in it: A PHOTO MUST
// NEVER REACH THE STORE. Ask a Local invites a traveler to photograph a
// minibar card, a menu, a prescription label, a passport page, and the
// promise it makes in return (TripQAImage, lib/tripQA.ts) is that the
// photo goes to the model with the request and is gone. A history feature
// is precisely where that promise gets broken by accident: the thread
// already holds the images, and "save the thread" is one JSON.stringify
// away from writing them to disk under the traveler's own hostname, where
// they then sit until site data is cleared.
//
// SavedAskTurn has no field an image could go in, so the compiler stops
// the obvious version of that mistake. This suite covers the rest: that
// toSavedTurns drops the images rather than passing them through, that an
// entry carrying one is refused on READ (which is what protects a browser
// that already has one from a build that did write them), and that what
// comes back out to the live thread has no photo in it either.
//
// The rest is the same lesson lib/recentTrips.test.ts was written for:
// this list outlives deploys, nothing versions it, and it renders in a
// panel - so a half-entry from an older build must be dropped rather than
// handed to React.
//
// localStorage is stubbed, so no browser.
//
// Run: npm run test:ask-history

// Imported statically: tsx compiles these suites to CJS, so there is no
// top-level await to sequence a dynamic import behind the stub below. Safe
// because askHistory.ts reads `window` INSIDE each function, never at
// module load.
import {
  MAX_ASK_CHATS,
  askChatTitle,
  clearAskChats,
  deleteAskChat,
  getAskChats,
  newAskChatId,
  saveAskChat,
  toLiveMessages,
  toSavedTurns,
} from "./askHistory";
import type { TripQAMessage } from "./tripQA";
import { check, finish, heading, section } from "./testutil";

heading("saved Ask a Local conversations");

const STORAGE_KEY = "decide:askChats";

/** A localStorage that can be told to refuse writes, which is how the
 * quota path is reached without filling 5MB. */
function installStorage() {
  const store = new Map<string, string>();
  let refuseOver = Infinity;
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > refuseOver) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return {
    store,
    refuseWritesOver(bytes: number) {
      refuseOver = bytes;
    },
    allowAllWrites() {
      refuseOver = Infinity;
    },
  };
}

const storage = installStorage();

const PHOTO = { mediaType: "image/jpeg" as const, data: "QUJDRA==" };

function thread(over: Partial<{ photo: boolean }> = {}): TripQAMessage[] {
  return [
    {
      role: "user",
      content: "Is this minibar card saying the water is free?",
      ...(over.photo ? { images: [PHOTO] } : {}),
    },
    { role: "assistant", content: "It says the still water is included and the sparkling is not." },
  ];
}

function raw(): string {
  return storage.store.get(STORAGE_KEY) ?? "";
}

// ---------------------------------------------------------------------------
section("a photo never reaches the store");

clearAskChats();
saveAskChat({ id: "chat-photo", voice: null, messages: thread({ photo: true }) });

check("the stored JSON contains no base64 image data", !raw().includes(PHOTO.data), raw().slice(0, 200));
check("the stored JSON has no images field at all", !raw().includes("images"), raw().slice(0, 200));
check(
  "but it records THAT a photo was attached",
  getAskChats()[0]?.turns[0]?.hadPhoto === true,
  JSON.stringify(getAskChats()[0]?.turns[0])
);
check(
  "toSavedTurns drops the images rather than passing them through",
  toSavedTurns(thread({ photo: true })).every((turn) => !("images" in turn))
);
check(
  "what goes back to the live thread carries no photo either",
  toLiveMessages(getAskChats()[0]!.turns).every((message) => message.images === undefined)
);

// A browser that already has images on disk, from a build that wrote them.
// Reading them back is the second chance to get this wrong.
storage.store.set(
  STORAGE_KEY,
  JSON.stringify([
    {
      id: "chat-legacy",
      title: "Is this minibar card saying the water is free?",
      voice: null,
      updatedAt: 10,
      turns: [{ role: "user", content: "Is this free?", images: [PHOTO] }],
    },
  ])
);
check("an entry carrying a photo is refused on read", getAskChats().length === 0, JSON.stringify(getAskChats()));

// ---------------------------------------------------------------------------
section("what is worth saving");

clearAskChats();
check(
  "a thread with no answer yet is not saved",
  saveAskChat({ id: "a", voice: null, messages: [{ role: "user", content: "Hello?" }] }) === null
);
check("and nothing was written", getAskChats().length === 0);

check(
  "a thread whose answer is still empty is not saved either",
  saveAskChat({
    id: "a",
    voice: null,
    messages: [
      { role: "user", content: "Hello?" },
      { role: "assistant", content: "" },
    ],
  }) === null
);

const saved = saveAskChat({ id: "a", voice: "night", messages: thread() });
check("a finished exchange is saved", saved !== null);
check("with the voice that answered it", getAskChats()[0]?.voice === "night", String(getAskChats()[0]?.voice));
check("and the empty placeholder is not stored as a turn", getAskChats()[0]?.turns.length === 2);

// ---------------------------------------------------------------------------
section("the list");

clearAskChats();
for (let i = 0; i < MAX_ASK_CHATS + 5; i++) {
  saveAskChat({
    id: `chat-${i}`,
    voice: null,
    messages: [
      { role: "user", content: `Question ${i}` },
      { role: "assistant", content: `Answer ${i}` },
    ],
  });
}
const list = getAskChats();
check(`capped at ${MAX_ASK_CHATS}`, list.length === MAX_ASK_CHATS, String(list.length));
check("newest first", list[0]?.id === `chat-${MAX_ASK_CHATS + 4}`, String(list[0]?.id));
check("the oldest was dropped", !list.some((chat) => chat.id === "chat-0"));

// Adding to an existing conversation updates it in place rather than
// filling the list with one conversation twice.
const before = getAskChats().length;
saveAskChat({
  id: "chat-7",
  voice: null,
  messages: [
    { role: "user", content: "Question 7" },
    { role: "assistant", content: "Answer 7" },
    { role: "user", content: "And the other one?" },
    { role: "assistant", content: "That one is not." },
  ],
});
check("continuing a conversation does not add a second entry", getAskChats().length === before, String(before));
check("it moves to the front", getAskChats()[0]?.id === "chat-7", String(getAskChats()[0]?.id));
check("holding all four turns", getAskChats()[0]?.turns.length === 4, String(getAskChats()[0]?.turns.length));

deleteAskChat("chat-7");
check("deleting removes exactly that one", !getAskChats().some((chat) => chat.id === "chat-7"));
check("and leaves the rest", getAskChats().length === before - 1, String(getAskChats().length));

// ---------------------------------------------------------------------------
section("surviving what is already on disk");

const bad: [string, unknown][] = [
  ["not an array", { id: "x" }],
  ["an entry with no turns", { id: "x", title: "t", voice: null, updatedAt: 1, turns: [] }],
  ["an entry whose turns are missing", { id: "x", title: "t", voice: null, updatedAt: 1 }],
  ["an entry with no id", { title: "t", voice: null, updatedAt: 1, turns: [{ role: "user", content: "hi" }] }],
  [
    "an entry with an unknown voice",
    { id: "x", title: "t", voice: "astronaut", updatedAt: 1, turns: [{ role: "user", content: "hi" }] },
  ],
  [
    "an entry with a turn in no known role",
    { id: "x", title: "t", voice: null, updatedAt: 1, turns: [{ role: "system", content: "hi" }] },
  ],
  [
    "an entry whose updatedAt is not a number",
    { id: "x", title: "t", voice: null, updatedAt: "today", turns: [{ role: "user", content: "hi" }] },
  ],
];
for (const [label, entry] of bad) {
  storage.store.set(STORAGE_KEY, JSON.stringify(Array.isArray(entry) ? entry : [entry]));
  check(`${label} is dropped`, getAskChats().length === 0, JSON.stringify(getAskChats()));
}

storage.store.set(STORAGE_KEY, "{not json");
check("unparseable storage reads as empty", getAskChats().length === 0);
storage.store.set(STORAGE_KEY, JSON.stringify({ chats: [] }));
check("storage that is not an array reads as empty", getAskChats().length === 0);

// A good entry beside a broken one: the good one still shows.
storage.store.set(
  STORAGE_KEY,
  JSON.stringify([
    { id: "broken", title: "t", voice: null, updatedAt: 1 },
    { id: "fine", title: "Rome in May?", voice: null, updatedAt: 2, turns: [{ role: "user", content: "Rome in May?" }] },
  ])
);
const mixed = getAskChats();
check("a broken entry does not take the good ones with it", mixed.length === 1 && mixed[0]!.id === "fine");

// ---------------------------------------------------------------------------
section("titles");

check(
  "the title is the first question asked",
  askChatTitle([
    { role: "user", content: "  Is Keramas or Ubud better\n for a honeymoon?  " },
    { role: "assistant", content: "Different vibes." },
  ]) === "Is Keramas or Ubud better for a honeymoon?"
);
check(
  "a long question is cut at a word",
  askChatTitle([
    {
      role: "user",
      content:
        "Is it safe to walk back from the beach bars in Keramas after midnight, or should we always get a driver",
    },
  ]) === "Is it safe to walk back from the beach bars in Keramas after midnight..."
);
check(
  "and the cut does not land on a comma",
  !askChatTitle([
    {
      role: "user",
      content:
        "Is it safe to walk back from the beach bars in Keramas after midnight, or should we always get a driver",
    },
  ]).includes(",...")
);
check(
  "a question that is one long word is still cut",
  askChatTitle([{ role: "user", content: "a".repeat(200) }]).length === 75,
  String(askChatTitle([{ role: "user", content: "a".repeat(200) }]).length)
);
check(
  "a photo with nothing typed has no title, for the UI to label",
  askChatTitle([{ role: "user", content: "", hadPhoto: true }]) === ""
);
check(
  "an assistant turn is never the title",
  askChatTitle([
    { role: "assistant", content: "Different vibes." },
    { role: "user", content: "Which one?" },
  ]) === "Which one?"
);

// ---------------------------------------------------------------------------
section("no room on disk");

clearAskChats();
storage.allowAllWrites();
for (let i = 0; i < 5; i++) {
  saveAskChat({
    id: `full-${i}`,
    voice: null,
    messages: [
      { role: "user", content: `Question ${i}` },
      { role: "assistant", content: "x".repeat(400) },
    ],
  });
}
check("five conversations stored", getAskChats().length === 5, String(getAskChats().length));

// Room for about two of them from here on.
storage.refuseWritesOver(1100);
const squeezed = saveAskChat({
  id: "full-new",
  voice: null,
  messages: [
    { role: "user", content: "The newest question" },
    { role: "assistant", content: "x".repeat(400) },
  ],
});
check("the newest conversation is still saved when the quota is tight", squeezed !== null);
const after = getAskChats();
check("the newest is the one kept", after[0]?.id === "full-new", String(after[0]?.id));
check("older ones were shed to make room", after.length < 6, String(after.length));
storage.allowAllWrites();

// Nothing fits at all: leave nothing behind pretending to be the history.
clearAskChats();
storage.refuseWritesOver(0);
check(
  "a write that cannot fit at all reports failure",
  saveAskChat({
    id: "no-room",
    voice: null,
    messages: [
      { role: "user", content: "Anything?" },
      { role: "assistant", content: "No." },
    ],
  }) === null
);
check("and leaves no half-written list", getAskChats().length === 0);
storage.allowAllWrites();

// ---------------------------------------------------------------------------
section("ids");

const ids = new Set(Array.from({ length: 500 }, () => newAskChatId()));
check("ids do not collide", ids.size === 500, String(ids.size));
check("and are non-empty strings", [...ids].every((id) => typeof id === "string" && id.length > 0));

finish();
