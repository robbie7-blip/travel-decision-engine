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

// Shared between the home page and /trip/[jobId] so a language choice made
// on either one sticks across the whole site.
export const LANGUAGE_STORAGE_KEY = "decide:language";

export interface Dictionary {
  tagline: string;
  howItWorks: string;
  browseDestinations: string;
  // Two sentences, rendered on separate lines (see page.tsx) — same reason
  // as subheadLine1/2: natural wrap doesn't reliably break at the sentence
  // boundary once the translation's line lengths differ from English's.
  headlineLine1: string;
  headlineLine2: string;
  // Two sentences, rendered on separate lines (see page.tsx) — kept apart so
  // "Never hidden, never overstated." never gets split by a text wrap that
  // strands "Never" alone at the end of the line above it.
  subheadLine1: string;
  subheadLine2: string;
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
  // Cycled through (one at a time, every few seconds) while a job is
  // "running" instead of showing one static "Generating…" message for the
  // full minute-plus wait — same idea as Booking.com/Wizzair's loading
  // screens. Every other job status still uses the single static
  // jobStatus label above.
  runningMessages: string[];
  form: {
    destinations: string;
    destinationsPlaceholder: string;
    compareToggleLabel: string;
    compareDestinations: string;
    compareDestinationsPlaceholder: string;
    origin: string;
    originPlaceholder: string;
    skipLodgingLabel: string;
    skipFlightLabel: string;
    // A single combined start/end date picker (see components/
    // DateRangePicker.tsx) rather than two separate date fields.
    dates: string;
    datesPlaceholder: string;
    // Shown under the calendar once a start date is picked but no end date
    // yet, prompting the second click.
    datesPickEnd: string;
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
    reassurance: string;
    notSurePrompt: string;
  };
  result: {
    budgetFeasible: string;
    budgetNotFeasible: string;
    minEstimate: string;
    // "{percent}% " is prepended by the component; this is just the word
    // after the number (e.g. "92% verified").
    trustScoreLabel: string;
    // "{grounded}" / "{total}" placeholders — one sentence explaining what
    // the trust score percentage actually counted.
    trustScoreDetail: string;
    downloadCalendar: string;
    keyDecisions: string;
    confidenceLevel: Record<"high" | "medium" | "low", string>;
    vs: string;
    day: string;
    inlineTierLabel: Partial<Record<ConfidenceTier, string>>;
    // One-sentence, tier-specific explanation of what that confidence level
    // actually means — shown when a visitor expands an item's evidence
    // rather than just taking the dot color on faith.
    tierExplainer: Record<ConfidenceTier, string>;
    evidenceShow: string;
    evidenceHide: string;
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
  // Homepage footer band translating the confidence-tier system into plain
  // language (see components/TrustFooter.tsx) — decide's answer to a
  // Booking.com-style "why trust us" strip, built from claims the app
  // already makes rather than partner logos or certifications it doesn't
  // have. Reuses tierLegend (short label) and result.tierExplainer (the
  // one-sentence explanation) rather than duplicating that copy.
  trustFooter: {
    heading: string;
    intro: string;
  };
  trip: {
    planAnother: string;
    notFound: string;
    loading: string;
  };
  // Bookmarks a browser has visited (see lib/recentTrips.ts) — no accounts,
  // purely a localStorage list of previously generated /trip/[jobId] links.
  recentTrips: {
    heading: string;
    remove: string; // aria-label on the per-entry remove button
  };
  // Homepage "see a real example" link — only rendered when an admin has
  // set a real, already-generated trip via /admin/demo-trip (see
  // lib/demoTrip.ts). "{destination}" placeholder.
  demo: {
    seeExample: string;
  };
  // The /showcase gallery — a curated list of real, already-generated trips
  // (see lib/showcase.ts), admin-managed via /admin/showcase.
  showcase: {
    navLabel: string;
    pageTitle: string;
    pageDescription: string;
    emptyState: string;
    viewTrip: string;
    daysLabel: string; // "{count}" placeholder, e.g. "9 days"
  };
  // The /compare page — two full generations, same trip, different
  // destination, shown side by side.
  compare: {
    heading: string;
    totalCost: string;
    missingJobs: string; // shown if the page is loaded without both ?a=/?b= ids
    planAnother: string;
  };
  destinations: {
    pageTitle: string;
    pageDescription: string; // "{count}" placeholder for the city count
    notOnListNote: string;
    localNotesCount: string; // "{count}" placeholder
    backToAll: string;
    eyebrow: string;
    introDisclaimer: string; // "{city}" placeholder
    categoryLabels: Record<"transit" | "cost" | "dietary" | "tourist_trap_warning" | "activity" | "practical", string>;
    readMoreWikipedia: string;
    planTrip: string; // "{city}" placeholder
    notLimitedNote: string;
    moreGuides: string;
    photoCredit: string;
    metaIndexDescription: string;
    metaDetailTitle: string; // "{city}" placeholder
    metaDetailDescription: string; // "{city}" placeholder
  };
}

const en: Dictionary = {
  tagline: "Your travel, decided.",
  howItWorks: "How it works",
  browseDestinations: "Destination guides",
  headlineLine1: "It doesn’t list options.",
  headlineLine2: "It decides for you.",
  subheadLine1: "Every line carries its own confidence - a verified fact, a single source, or an honest guess.",
  subheadLine2: "Never hidden, never overstated.",
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
  runningMessages: [
    "Checking live prices…",
    "Cross-referencing lodging costs…",
    "Confirming named venues are still open…",
    "Weighing options against your budget…",
    "Double-checking the numbers that matter…",
    "Putting the itinerary together…",
  ],
  form: {
    destinations: "Destinations (comma-separated)",
    destinationsPlaceholder: "Brussels, Bruges",
    compareToggleLabel: "Compare with another destination (same dates, budget, and preferences)",
    compareDestinations: "Compare against",
    compareDestinationsPlaceholder: "e.g. Athens",
    origin: "Traveling from (optional)",
    originPlaceholder: "e.g. London - used to estimate real arrival/departure transport cost",
    skipLodgingLabel: "I already have accommodation sorted (e.g. business trip) - skip lodging suggestions",
    skipFlightLabel: "I already have a flight/train booked - skip transport suggestions and cost",
    dates: "Dates",
    datesPlaceholder: "Select start and end dates",
    datesPickEnd: "Now pick the end date",
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
    reassurance: "Takes about a minute - we check live prices as we plan, not guesses.",
    notSurePrompt: "Not sure where to go yet? Browse destination guides →",
  },
  result: {
    budgetFeasible: "Budget: feasible",
    budgetNotFeasible: "Budget: not feasible as stated",
    minEstimate: "Model's minimum estimate",
    trustScoreLabel: "verified",
    trustScoreDetail: "{grounded} of {total} line items are backed by a live search or a checked fact - the rest are honest, hedged guesses, not fabricated numbers.",
    downloadCalendar: "Add to calendar (.ics)",
    keyDecisions: "Key decisions",
    confidenceLevel: { high: "high", medium: "medium", low: "low" },
    vs: "vs",
    day: "Day",
    inlineTierLabel: {
      single_source: "single source",
      inferred: "unverified",
    },
    tierExplainer: {
      verified: "Two independent searches were checked against each other and roughly agreed — this number reflects what was actually found, not a guess.",
      fact_grounded: "This comes from decide's curated local knowledge base, not a live search — solid background, not price-checked in real time.",
      single_source: "One live search returned a usable result. It wasn't cross-checked against a second source, so treat it as reliable but not double-verified.",
      conflicting: "Two live searches disagreed on this. Both figures are shown so you can judge for yourself — the higher one was used as the safer assumption.",
      inferred: "No reliable live search result was found for this. This is an honest, hedged estimate based on general knowledge, not a checked price.",
    },
    evidenceShow: "How do we know this?",
    evidenceHide: "Hide",
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
  trustFooter: {
    heading: "Why the numbers can be trusted",
    intro: "Every line in an itinerary carries one of five confidence levels - shown openly, never averaged away or hidden behind a single score.",
  },
  trip: {
    planAnother: "Plan your own trip",
    notFound: "This trip link has expired or doesn't exist.",
    loading: "Loading your trip…",
  },
  recentTrips: {
    heading: "Your recent trips",
    remove: "Remove",
  },
  demo: {
    seeExample: "See a real example: {destination} →",
  },
  showcase: {
    navLabel: "Real examples",
    pageTitle: "Real trips decide has already planned",
    pageDescription: "Full itineraries, not mockups - every confidence dot, budget stamp, and trust score exactly as generated.",
    emptyState: "No examples here yet - check back soon.",
    viewTrip: "View full itinerary →",
    daysLabel: "{count} days",
  },
  compare: {
    heading: "Which one actually works better?",
    totalCost: "Est. total cost",
    missingJobs: "This comparison link is missing one or both trips.",
    planAnother: "Plan a new comparison",
  },
  destinations: {
    pageTitle: "Destination guides",
    pageDescription:
      "Local notes decide already has on hand for these {count} cities - real costs, how to get around, and what to skip - before a live search ever runs.",
    notOnListNote: "Not on this list? decide plans anywhere - these are just a head start.",
    localNotesCount: "{count} local notes",
    backToAll: "← All destinations",
    eyebrow: "DESTINATION GUIDE",
    introDisclaimer:
      "A few things decide already knows about {city} before it even runs a live search - grounded background, not a substitute for the price checks a real itinerary still runs.",
    categoryLabels: {
      transit: "Getting around",
      cost: "What things cost",
      dietary: "Dietary notes",
      tourist_trap_warning: "Tourist-trap watch",
      activity: "Worth knowing",
      practical: "Practical",
    },
    readMoreWikipedia: "Read more on Wikipedia ↗",
    planTrip: "Plan a trip to {city} →",
    notLimitedNote: "decide isn't limited to these cities - tell it any destination and it runs the same live price checks either way.",
    moreGuides: "More destination guides",
    photoCredit: "Photo:",
    metaIndexDescription: "What decide already knows about 18 cities before it even runs a live search.",
    metaDetailTitle: "{city} travel notes — decide",
    metaDetailDescription:
      "What decide already knows about {city} before it even runs a live search: getting around, real costs, and what locals skip.",
  },
};

const bg: Dictionary = {
  tagline: "Твоето пътуване, измислено.",
  howItWorks: "Как работи",
  browseDestinations: "Пътеводители",
  headlineLine1: "Без опции.",
  headlineLine2: "Решава вместо теб.",
  subheadLine1: "Всеки ред носи собствена увереност - факт, единствен източник или предположение.",
  subheadLine2: "Никога скрито, никога преувеличено.",
  howItWorksSteps: {
    step1Title: "Кажи ни за пътуването",
    step1Body: "Дестинации, дати, бюджет, темп - нещата, които приятел би попитал преди да планира.",
    step2Title: "Проверяваме реални цени",
    step2Body: "Търсене на живо потвърждава нощувки и конкретни места, вместо да гадаем.",
    step3Title: "Всеки ред показва увереността си",
    step3Body: "Потвърдено, един източник или честно предположение - винаги ясно означено.",
  },
  tierLegend: {
    verified: "2 източника съвпадат",
    fact_grounded: "базирано на факт",
    single_source: "един източник",
    conflicting: "не съвпадат",
    inferred: "честно предположение",
  },
  jobStatus: {
    pending: "На опашка…",
    running: "Генериране - проверка на актуални цени, това може да отнеме минута-две…",
    done: "Готово",
    error: "Неуспешно",
  },
  runningMessages: [
    "Проверка на актуални цени…",
    "Кръстосана проверка на цени за настаняване…",
    "Потвърждаване, че местата все още работят…",
    "Съпоставяне на опциите с бюджета…",
    "Двойна проверка на важните цифри…",
    "Сглобяване на плана…",
  ],
  form: {
    destinations: "Дестинации (разделени със запетая)",
    destinationsPlaceholder: "Брюксел, Брюж",
    compareToggleLabel: "Сравни с друга дестинация (същите дати, бюджет и предпочитания)",
    compareDestinations: "Сравни със",
    compareDestinationsPlaceholder: "напр. Атина",
    origin: "Заминаване от (по избор)",
    originPlaceholder:
      "напр. Лондон - използва се за оценка на реалната цена на транспорта при пристигане/заминаване",
    skipLodgingLabel: "Вече имам настаняване (напр. командировка) - пропусни предложенията за нощувка",
    skipFlightLabel: "Вече имам резервиран полет/влак - пропусни предложенията и цената за транспорт",
    dates: "Дати",
    datesPlaceholder: "Избери начална и крайна дата",
    datesPickEnd: "Сега избери крайната дата",
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
    reassurance: "Отнема около минута - проверяваме актуални цени, докато планираме, не гадаем.",
    notSurePrompt: "Все още не сте сигурни къде? Разгледайте пътеводителите →",
  },
  result: {
    budgetFeasible: "Бюджет: постижим",
    budgetNotFeasible: "Бюджет: непостижим при тези условия",
    minEstimate: "Минимална оценка на модела",
    trustScoreLabel: "проверено",
    trustScoreDetail: "{grounded} от {total} елемента са базирани на търсене на живо или проверен факт - останалите са честни, хеджирани предположения, не измислени цифри.",
    downloadCalendar: "Добави в календар (.ics)",
    keyDecisions: "Ключови решения",
    confidenceLevel: { high: "висока", medium: "средна", low: "ниска" },
    vs: "срещу",
    day: "Ден",
    inlineTierLabel: {
      single_source: "един източник",
      inferred: "непотвърдено",
    },
    tierExplainer: {
      verified: "Две независими търсения бяха сравнени едно с друго и приблизително съвпаднаха - тази цифра отразява какво реално беше намерено, не предположение.",
      fact_grounded: "Това идва от подбраната база от местни знания на decide, а не от търсене на живо - солидна основа, но не проверена в реално време.",
      single_source: "Едно търсене на живо върна използваем резултат. Не беше кръстосано проверено с втори източник, така че го приемайте като надеждно, но не двойно потвърдено.",
      conflicting: "Две търсения на живо се разминаха по този въпрос. И двете цифри са показани, за да прецените сами - по-високата беше използвана като по-безопасно предположение.",
      inferred: "Не беше намерен надежден резултат от търсене на живо за това. Това е честна, хеджирана оценка, базирана на общи познания, не проверена цена.",
    },
    evidenceShow: "Откъде знаем това?",
    evidenceHide: "Скрий",
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
  trustFooter: {
    heading: "Защо на цифрите може да се вярва",
    intro: "Всеки ред в плана носи едно от пет нива на увереност - показани открито, никога осреднени или скрити зад една обща оценка.",
  },
  trip: {
    planAnother: "Планирайте свое пътуване",
    notFound: "Тази връзка е изтекла или не съществува.",
    loading: "Зареждане на пътуването…",
  },
  recentTrips: {
    heading: "Скорошни пътувания",
    remove: "Премахни",
  },
  demo: {
    seeExample: "Виж реален пример: {destination} →",
  },
  showcase: {
    navLabel: "Реални примери",
    pageTitle: "Реални пътувания, планирани от decide",
    pageDescription: "Пълни планове, не макети - всяка точка на увереност, печат за бюджет и оценка на доверие точно както са генерирани.",
    emptyState: "Все още няма примери тук - провери отново скоро.",
    viewTrip: "Виж целия план →",
    daysLabel: "{count} дни",
  },
  compare: {
    heading: "Кое всъщност е по-добрият избор?",
    totalCost: "Прибл. обща цена",
    missingJobs: "На тази връзка за сравнение липсва едно или и двете пътувания.",
    planAnother: "Планирай ново сравнение",
  },
  destinations: {
    pageTitle: "Пътеводители по дестинации",
    pageDescription:
      "Местни бележки за {count} града - реални цени, придвижване и какво да пропуснете, преди да търсим на живо.",
    notOnListNote: "Няма я в списъка? decide планира навсякъде - тези градове са само примери.",
    localNotesCount: "{count} местни бележки",
    backToAll: "← Всички дестинации",
    eyebrow: "ПЪТЕВОДИТЕЛ",
    introDisclaimer:
      "Няколко неща, които decide вече знае за {city}, преди изобщо да направи търсене на живо - основна информация, не заместител на проверките на цени, които реален маршрут все пак прави.",
    categoryLabels: {
      transit: "Придвижване",
      cost: "Колко струват нещата",
      dietary: "Хранителни бележки",
      tourist_trap_warning: "Внимание за туристически капани",
      activity: "Полезно е да знаете",
      practical: "Практично",
    },
    readMoreWikipedia: "Прочетете повече в Уикипедия ↗",
    planTrip: "Планирай пътуване до {city} →",
    notLimitedNote: "decide не е ограничен до тези градове - кажете му всяка дестинация и той прави същите проверки на живо цени.",
    moreGuides: "Още пътеводители",
    photoCredit: "Снимка:",
    metaIndexDescription: "Какво decide вече знае за 18 града, преди изобщо да направи търсене на живо.",
    metaDetailTitle: "{city} - бележки за пътуване - decide",
    metaDetailDescription:
      "Какво decide вече знае за {city}, преди изобщо да направи търсене на живо: придвижване, реални разходи и какво пропускат местните.",
  },
};

export const TRANSLATIONS: Record<Language, Dictionary> = { en, bg };
