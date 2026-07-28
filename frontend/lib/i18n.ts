// Hand-rolled translation dictionary — deliberately not a formal i18n library
// (next-intl etc.): the app has one page and a fixed, known set of UI
// strings, so a flat object keyed by Language is simpler to maintain than
// wiring up a routing/loader layer for two locales. Covers UI chrome only;
// the generated itinerary's own language is a separate concern (see
// LANGUAGE_LABEL in lib/engine/prompt.ts), driven by the same Language value.

import type { ConfidenceTier, Language } from "./types";
import type { JobStatus } from "./jobs";

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  bg: "Български",
};

export interface Dictionary {
  tagline: string;
  howItWorks: string;
  headline: string;
  subhead: string;
  howItWorksSteps: {
    step1Title: string;
    step1Body: string;
    step2Title: string;
    step2Body: string;
    step3Title: string;
    step3Body: string;
  };
  tierLegend: Record<ConfidenceTier, string>;
  jobStatus: Record<JobStatus, string>;
  form: {
    destinations: string;
    destinationsPlaceholder: string;
    origin: string;
    originPlaceholder: string;
    startDate: string;
    startDatePlaceholder: string;
    endDate: string;
    endDatePlaceholder: string;
    partySize: string;
    partyDescription: string;
    partyPlaceholder: string;
    budget: string;
    budgetPlaceholder: string;
    pace: string;
    paceRelaxed: string;
    paceModerate: string;
    pacePacked: string;
    interests: string;
    interestsPlaceholder: string;
    mustSee: string;
    mustSeePlaceholder: string;
    dietary: string;
    dietaryPlaceholder: string;
    mobility: string;
    mobilityPlaceholder: string;
    hardNo: string;
    hardNoPlaceholder: string;
    submit: string;
    submitting: string;
  };
  result: {
    budgetFeasible: string;
    budgetNotFeasible: string;
    minEstimate: string;
    keyDecisions: string;
    confidenceLevel: Record<"high" | "medium" | "low", string>;
    vs: string;
    day: string;
    inlineTierLabel: Partial<Record<ConfidenceTier, string>>;
    sourcesDisagree: string;
    source: string;
    skipThis: string;
    feedbackHelpful: string;
    feedbackWrong: string;
    feedbackPlaceholder: string;
    feedbackSubmit: string;
    feedbackThanks: string;
    feedbackFailed: string;
    pushbackLabel: string;
    pushbackPlaceholder: string;
    pushbackSubmit: string;
    pushbackSubmitting: string;
    pushbackYouAsked: string;
  };
  genericError: string;
}

const en: Dictionary = {
  tagline: "Your travel, decided.",
  howItWorks: "How it works",
  headline: "It doesn’t list options. It decides for you.",
  subhead: "Every line carries its own confidence - a verified fact, a single source, or an honest guess. Never hidden, never overstated.",
  howItWorksSteps: {
    step1Title: "Tell us the trip",
    step1Body: "Destinations, dates, budget, pace - the things a friend would ask before planning.",
    step2Title: "We check real prices",
    step2Body: "Live search verifies lodging and named venues instead of guessing.",
    step3Title: "Every line shows its confidence",
    step3Body: "Verified, single-source, or an honest guess - never hidden, never overstated.",
  },
  tierLegend: {
    verified: "2 sources agree",
    fact_grounded: "grounded in a fact",
    single_source: "single source",
    conflicting: "sources disagree",
    inferred: "unverified guess",
  },
  jobStatus: {
    pending: "Queued…",
    running: "Generating - checking live prices, this can take a minute or two…",
    done: "Done",
    error: "Failed",
  },
  form: {
    destinations: "Destinations (comma-separated)",
    destinationsPlaceholder: "Brussels, Bruges",
    origin: "Traveling from (optional)",
    originPlaceholder: "e.g. London - used to estimate real arrival/departure transport cost",
    startDate: "Start date (YYYY-MM-DD)",
    startDatePlaceholder: "2026-10-10",
    endDate: "End date (YYYY-MM-DD)",
    endDatePlaceholder: "2026-10-13",
    partySize: "Party size",
    partyDescription: "Party description",
    partyPlaceholder: "couple, late 20s",
    budget: "Total budget (EUR, optional)",
    budgetPlaceholder: "leave blank if flexible",
    pace: "Pace",
    paceRelaxed: "Relaxed",
    paceModerate: "Moderate",
    pacePacked: "Packed",
    interests: "Interests (comma-separated)",
    interestsPlaceholder: "food, architecture, beer culture",
    mustSee: "Must-see / must-do (optional, comma-separated)",
    mustSeePlaceholder: "a specific restaurant, a museum you've been wanting to visit",
    dietary: "Dietary constraints (optional)",
    dietaryPlaceholder: "vegetarian",
    mobility: "Mobility constraints (optional)",
    mobilityPlaceholder: "limited walking",
    hardNo: "Hard constraints (optional, comma-separated)",
    hardNoPlaceholder: "no overnight trains, no early mornings",
    submit: "Generate itinerary",
    submitting: "Deciding…",
  },
  result: {
    budgetFeasible: "Budget: feasible",
    budgetNotFeasible: "Budget: not feasible as stated",
    minEstimate: "Model's minimum estimate",
    keyDecisions: "Key decisions",
    confidenceLevel: { high: "high", medium: "medium", low: "low" },
    vs: "vs",
    day: "Day",
    inlineTierLabel: {
      single_source: "single source",
      inferred: "unverified",
    },
    sourcesDisagree: "sources disagree",
    source: "source",
    skipThis: "Skip this",
    feedbackHelpful: "looks right",
    feedbackWrong: "flag as wrong",
    feedbackPlaceholder: "what was wrong? (optional)",
    feedbackSubmit: "submit",
    feedbackThanks: "thanks - noted",
    feedbackFailed: "failed - try again",
    pushbackLabel: "Push back on this",
    pushbackPlaceholder: "e.g. \"why not the cheaper hotel near the station?\"",
    pushbackSubmit: "ask",
    pushbackSubmitting: "thinking…",
    pushbackYouAsked: "You asked",
  },
  genericError: "Something went wrong. Try again.",
};

const bg: Dictionary = {
  tagline: "Твоето пътуване, измислено.",
  howItWorks: "Как работи",
  headline: "Без опции. Решава вместо теб.",
  subhead: "Всеки ред носи собствено ниво на увереност - потвърден факт, един източник или честно предположение. Никога скрито, никога преувеличено.",
  howItWorksSteps: {
    step1Title: "Кажи ни за пътуването",
    step1Body: "Дестинации, дати, бюджет, темп - нещата, които приятел би попитал преди да планира.",
    step2Title: "Проверяваме реални цени",
    step2Body: "Търсене на живо потвърждава нощувки и конкретни места, вместо да гадаем.",
    step3Title: "Всеки ред показва увереността си",
    step3Body: "Потвърдено, от един източник или честно предположение - никога скрито, никога преувеличено.",
  },
  tierLegend: {
    verified: "2 източника съвпадат",
    fact_grounded: "базирано на факт",
    single_source: "един източник",
    conflicting: "източниците се разминават",
    inferred: "непотвърдено предположение",
  },
  jobStatus: {
    pending: "На опашка…",
    running: "Генериране - проверка на актуални цени, това може да отнеме минута-две…",
    done: "Готово",
    error: "Неуспешно",
  },
  form: {
    destinations: "Дестинации (разделени със запетая)",
    destinationsPlaceholder: "Брюксел, Брюж",
    origin: "Заминаване от (по избор)",
    originPlaceholder:
      "напр. Лондон - използва се за оценка на реалната цена на транспорта при пристигане/заминаване",
    startDate: "Начална дата (ГГГГ-ММ-ДД)",
    startDatePlaceholder: "2026-10-10",
    endDate: "Крайна дата (ГГГГ-ММ-ДД)",
    endDatePlaceholder: "2026-10-13",
    partySize: "Брой пътуващи",
    partyDescription: "Описание на групата",
    partyPlaceholder: "двойка, около 20-те",
    budget: "Общ бюджет (EUR, по избор)",
    budgetPlaceholder: "оставете празно, ако е гъвкав",
    pace: "Темп",
    paceRelaxed: "Спокоен",
    paceModerate: "Умерен",
    pacePacked: "Наситен",
    interests: "Интереси (разделени със запетая)",
    interestsPlaceholder: "храна, архитектура, бирена култура",
    mustSee: "Задължителни места/дейности (по избор, разделени със запетая)",
    mustSeePlaceholder: "конкретен ресторант, музей, който искате да посетите",
    dietary: "Хранителни ограничения (по избор)",
    dietaryPlaceholder: "вегетарианец",
    mobility: "Ограничения в придвижването (по избор)",
    mobilityPlaceholder: "ограничено ходене пеш",
    hardNo: "Твърди ограничения (по избор, разделени със запетая)",
    hardNoPlaceholder: "без нощни влакове, без ранни сутрини",
    submit: "Генерирай маршрут",
    submitting: "Решаваме…",
  },
  result: {
    budgetFeasible: "Бюджет: постижим",
    budgetNotFeasible: "Бюджет: непостижим при тези условия",
    minEstimate: "Минимална оценка на модела",
    keyDecisions: "Ключови решения",
    confidenceLevel: { high: "висока", medium: "средна", low: "ниска" },
    vs: "срещу",
    day: "Ден",
    inlineTierLabel: {
      single_source: "един източник",
      inferred: "непотвърдено",
    },
    sourcesDisagree: "източниците се разминават",
    source: "източник",
    skipThis: "Пропуснете това",
    feedbackHelpful: "изглежда вярно",
    feedbackWrong: "маркирай като грешно",
    feedbackPlaceholder: "какво не беше наред? (по избор)",
    feedbackSubmit: "изпрати",
    feedbackThanks: "благодарим - отбелязано",
    feedbackFailed: "неуспешно - опитайте отново",
    pushbackLabel: "Оспорете това",
    pushbackPlaceholder: "напр. „защо не по-евтиния хотел до гарата?“",
    pushbackSubmit: "попитай",
    pushbackSubmitting: "обмисля…",
    pushbackYouAsked: "Попитахте",
  },
  genericError: "Нещо не сработи. Опитайте отново.",
};

export const TRANSLATIONS: Record<Language, Dictionary> = { en, bg };
