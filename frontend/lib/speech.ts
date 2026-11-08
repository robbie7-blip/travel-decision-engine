// Talking to Ask a Local: speaking a question and hearing the answer.
//
// Both halves are the browser's own (the Web Speech API), so there is no
// new service, key or cost, and nothing recorded leaves the phone except
// through the browser's own speech service, the same one its keyboard
// dictation uses. Where a browser has no speech recognition (Firefox), the
// microphone button is simply not shown; reading aloud works almost
// everywhere.
//
// Run: npm run test:speech

export type Lang = "en" | "bg";

/** BCP 47 tags the browsers' speech services know. */
export const SPEECH_LANG: Record<Lang, string> = { en: "en-GB", bg: "bg-BG" };

/** The parts of SpeechRecognition this uses. Typed here because the DOM
 * library does not ship the (still prefixed) interface. */
export interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** A new recognizer, or null where the browser has none. */
export function createRecognizer(win: unknown = typeof window === "undefined" ? undefined : window): Recognizer | null {
  const w = win as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer } | undefined;
  const Ctor = w?.SpeechRecognition ?? w?.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function canListen(win: unknown = typeof window === "undefined" ? undefined : window): boolean {
  const w = win as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown } | undefined;
  return Boolean(w?.SpeechRecognition ?? w?.webkitSpeechRecognition);
}

export function canSpeak(win: unknown = typeof window === "undefined" ? undefined : window): boolean {
  const w = win as { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown } | undefined;
  return Boolean(w?.speechSynthesis && w?.SpeechSynthesisUtterance);
}

/** What a recognizer heard so far: the finished phrases and the one still
 * being spoken, joined. */
export function transcriptOf(results: ArrayLike<ArrayLike<{ transcript: string }>>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) parts.push(results[i][0]?.transcript ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** An answer as it should be read out: the [[place]] markers, link
 * addresses and Markdown that show on screen read as noise. */
export function speakableText(answer: string): string {
  return answer
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#>`]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The best installed voice for a language: one that matches the tag
 * exactly, else the language, preferring the browser's better (non-local
 * network, or "Google"/"Enhanced") voices. Null lets the browser choose. */
export function pickVoice<V extends { lang: string; name: string; localService?: boolean }>(voices: V[], lang: Lang): V | null {
  const tag = SPEECH_LANG[lang].toLowerCase();
  const base = lang;
  const matches = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base));
  if (matches.length === 0) return null;
  const score = (v: V) =>
    (v.lang.toLowerCase().replace("_", "-") === tag ? 4 : 0) + (/google|enhanced|premium|natural/i.test(v.name) ? 2 : 0);
  return [...matches].sort((a, b) => score(b) - score(a))[0];
}
