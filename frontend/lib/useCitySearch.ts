"use client";

// Asks /api/cities for matches from the full world list while a city is
// being typed, for CityCombobox and OriginCombobox. The short list in
// lib/cityOptions.ts still answers instantly; these arrive a moment later
// and go underneath it (mergeCitySuggestions).

import { useEffect, useState } from "react";
import type { CityOption } from "./cityOptions";
import type { Language } from "./types";

interface Remote {
  name: string;
  country: string;
  value: string;
}

// Answers are the same for everyone, so a session keeps them: typing
// "fri", deleting back and typing it again asks once.
const cache = new Map<string, Remote[]>();

export function useCitySearch(query: string, language: Language): { results: CityOption[]; loading: boolean } {
  const q = query.trim();
  const key = `${language}:${q.toLowerCase()}`;
  const [state, setState] = useState<{ key: string; results: Remote[] }>({ key: "", results: [] });

  useEffect(() => {
    if (q.length < 2 || cache.has(key)) return;
    const controller = new AbortController();
    // A short pause, so a word typed quickly is one request, not five.
    const timer = setTimeout(() => {
      fetch(`/api/cities?${new URLSearchParams({ q, lang: language })}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { cities: [] }))
        .then((data: { cities?: Remote[] }) => {
          const results = Array.isArray(data.cities) ? data.cities : [];
          cache.set(key, results);
          setState({ key, results });
        })
        // Offline or a server error: answered as "nothing found" rather than
        // left loading, so the "press Enter to add it anyway" hint can show
        // and the field still works. An abort is the next keystroke, not a
        // failure, and is left alone. Not cached, so the next try asks again.
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setState({ key, results: [] });
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, q, language]);

  if (q.length < 2) return { results: [], loading: false };
  const remote = cache.get(key) ?? (state.key === key ? state.results : null);
  // state.results is [] after a failed lookup: done, with nothing to add.
  return {
    results: (remote ?? []).map((r) => ({ name: r.name, country: r.country, value: r.value })),
    loading: remote === null,
  };
}
