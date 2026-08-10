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
  // Screen-reader-only label on the currency <select> (components/
  // CurrencySwitcher.tsx) — the currency codes themselves (EUR, USD...)
  // are intentionally left untranslated (ISO codes, not prose).
  currencyLabel: string;
  // Mobile-only nav toggle (see .nav-menu-toggle in globals.css) — collapses
  // the 6 header links behind a single "Menu" button instead of letting
  // them wrap onto 2-3 rows.
  navMenuOpen: string;
  navMenuClose: string;
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
    // Shown only when compareEnabled — lets the comparison side use its own
    // date range instead of forcing identical dates on both destinations.
    compareDifferentDatesLabel: string;
    compareDates: string;
    compareDatesPlaceholder: string;
    origin: string;
    originPlaceholder: string;
    skipLodgingLabel: string;
    accommodationLocation: string;
    accommodationLocationPlaceholder: string;
    skipFlightLabel: string;
    // Shown only when flights/trains are already booked separately — lets
    // the traveler state their real arrival timing so the engine doesn't
    // presume day 1 must be a light "just landed" day.
    arrivalDate: string;
    arrivalDatePlaceholder: string;
    arrivalTime: string;
    arrivalTimePlaceholder: string;
    // How the traveler wants to get around locally (see transport_preference
    // on TripBriefInput) — always shown, optional, defaults to no preference.
    transportPreference: string;
    transportNoPreference: string;
    transportPublicTransit: string;
    transportTaxiRideshare: string;
    transportWalking: string;
    // A single combined start/end date picker (see components/
    // DateRangePicker.tsx) rather than two separate date fields.
    dates: string;
    datesPlaceholder: string;
    // Shown under the calendar once a start date is picked but no end date
    // yet, prompting the second click.
    datesPickEnd: string;
    // Screen-reader-only labels on DateRangePicker/SingleDatePicker's month
    // arrows (see those files) — not visible text, but real content for a
    // screen-reader user, so still needs both languages like everything else.
    calendarPrevMonth: string;
    calendarNextMonth: string;
    partySize: string;
    partySizePlaceholder: string;
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
    // Shown instead of a price + confidence tier for a zero-cost item — free
    // by nature (a walk, browsing a neighborhood) needs no verification badge.
    free: string;
    // Weather outlook strip (see components/WeatherStrip.tsx) — sourced from
    // Open-Meteo, a real forecast when the trip is soon, a labeled historical
    // average otherwise (historicalNote explains which one is showing).
    weather: {
      heading: string;
      historicalNote: string;
      // Labels the bare percentage/mm figure so it's unambiguous what it
      // means (was previously shown as just "0%" with no context).
      rainChance: string;
      avgRain: string;
    };
    // Google Places verification on named-venue items (see worker/src/engine/
    // venueVerification.ts) — "{count}" placeholder for googleRatingCount.
    googleRatingCount: string;
    closedTemporarily: string;
    closedPermanently: string;
    viewOnGoogleMaps: string;
    // Google Flights deep link on flight items (see worker/src/engine/
    // flightLinks.ts) — always present when there's a real flight leg to
    // check, not dependent on whether the model's own search found a URL.
    // Doubles as the price display itself for any non-zero-cost flight item
    // (see ItineraryResult.tsx) — the model's own guessed fare has turned
    // out badly wrong often enough that it's no longer shown as a number.
    checkFlightPrices: string;
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
    didYouKnow: string; // label above the rotating city-fact shown on the loading screen
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
  // The /why-decide comparison page — confident, specific claims about what
  // decide actually does differently from a general-purpose chatbot,
  // grounded in real product behavior (confidence tiers, live price checks,
  // budget feasibility) rather than just asserting it's "better."
  whyDecide: {
    navLink: string;
    pageTitle: string;
    // Two explicit lines (not one string left to wrap on its own) so the
    // break always falls at the sentence boundary — a flexible single
    // string wraps wherever the viewport happens to cut it, which on a
    // narrow phone landed mid-sentence ("...It's a" / "decision.").
    headlineLine1: string;
    headlineLine2: string;
    // Same "generic AI chatbot vs decide" framing as the comparison rows
    // below, just as a two-line teaser right under the headline instead of
    // one flowing paragraph — sets up the ×/✓ visual language early.
    subheadGeneric: string;
    subheadDecide: string;
    columnHeadingGeneric: string; // e.g. "A GENERIC AI CHATBOT"
    columnHeadingDecide: string; // e.g. "DECIDE"
    rows: {
      title: string;
      generic: string;
      decide: string;
    }[];
    ctaHeading: string;
    ctaButton: string;
  };
  // The /compare page — two full generations, same trip, different
  // destination, shown side by side.
  compare: {
    heading: string;
    totalCost: string;
    missingJobs: string; // shown if the page is loaded without both ?a=/?b= ids
    planAnother: string;
  };
  // General trip Q&A (packing, safety, local customs) — see components/
  // TripQA.tsx, embedded on a generated itinerary's result page and also
  // standalone at /ask (see app/ask/page.tsx) for someone who hasn't
  // generated anything here at all.
  // "Ask a Local" — general trip Q&A (packing, safety, local customs),
  // named to fit the app's existing "opinionated local friend" voice
  // (see SYSTEM_PROMPT in worker/src/engine/prompt.ts) rather than a flat,
  // generic "Q&A" or "Ask a question" label.
  tripQA: {
    navLink: string; // homepage header link to /ask
    pageHeading: string;
    pageSubheading: string;
    sectionHeading: string; // heading when embedded on a generated itinerary
    placeholder: string;
    send: string;
    sending: string;
    thinking: string; // shown while waiting for the first word of a reply
    genericError: string;
    tooLong: string;
    // Clickable starter questions shown only before the first message —
    // fills what was otherwise a lot of empty space under the input box on
    // a fresh /ask visit, and doubles as a hint at the kind of question
    // this is for (packing/safety/customs, not itinerary planning).
    examplePrompts: string[];
    // 3 icon cards shown above the Q&A box on the standalone /ask page —
    // the page used to be just a heading and a plain input, with nothing
    // hinting at scope before you typed something.
    topics: { title: string; body: string }[];
  };
  // Pricing + account/sign-in — a signed-in visitor trades the anonymous
  // per-IP trial limit for a per-email monthly quota (see account.ts);
  // these two pages are the only UI for that. Kept as one section since
  // they share almost all their copy (plan names, quota wording).
  account: {
    navLink: string; // homepage header link to /pricing
    headerSignIn: string; // short "Sign in" label for the global SiteHeader button
    headerAccountLink: string; // short "Account" label for the same header slot once signed in
    pricingHeading: string;
    pricingSubheading: string;
    // 3 icon cards shown above the plan comparison — features every visitor
    // already gets regardless of plan (see lib/account.ts: quota is the
    // ONLY thing that's actually plan-gated), so the pricing page doesn't
    // read as an empty grid of two prices with nothing to compare.
    valuePropsHeading: string;
    valueProps: { title: string; body: string }[];
    freePlanName: string;
    freePlanBlurb: string; // "{count}" placeholder for FREE_MONTHLY_GENERATIONS
    freePlanFeatures: string[]; // checklist; "{count}" placeholder in the first entry
    paidPlanName: string;
    paidPlanBlurb: string; // "{count}" placeholder for PAID_MONTHLY_GENERATIONS
    paidPlanFeaturesIntro: string; // "Everything in Free, plus:"
    paidPlanFeatures: string[]; // checklist; "{count}"/"{multiplier}" placeholders in the first entry
    paidPlanPrice: string;
    emailLabel: string;
    emailPlaceholder: string;
    emailMismatchNote: string; // must match whatever email you later sign in with
    subscribeButton: string;
    subscribing: string;
    signInButton: string;
    signInSent: string;
    accountHeading: string;
    signedInAs: string; // "{email}" placeholder
    currentPlan: string; // "{plan}" placeholder
    quotaUsed: string; // "{used}" / "{limit}" placeholders
    renewsOn: string; // "{date}" placeholder
    upgradeCta: string;
    signOutButton: string;
    notSignedIn: string;
    invalidLink: string;
    genericError: string;
  };
  // The Been-style visited-countries tracker (lib/visited.ts) — a real
  // account is required (see app/api/visited), unlike RecentTrips which is
  // fine local-only.
  visited: {
    navLink: string; // link from /account to /account/visited
    homeNavLink: string; // link from the homepage header
    pageHeading: string;
    pageSubheading: string;
    statsCountries: string; // "{count}" placeholder
    statsPercent: string; // "{percent}" placeholder
    statsContinents: string; // "{count}" / "{total}" placeholders
    signInPrompt: string;
    signInButton: string;
    signInSent: string;
    badges: Record<
      "first_stamp" | "explorer" | "globetrotter" | "continent_hopper" | "all_continents" | "half_the_world",
      string
    >;
    backToAccount: string;
    shareHeading: string;
    shareBlurb: string;
    getShareLinkButton: string;
    copyLinkButton: string;
    linkCopied: string;
    compareInputLabel: string;
    compareInputPlaceholder: string;
    compareButton: string;
    // The interactive map (components/VisitedMap.tsx) — mapVisited/
    // mapNotVisited/mapUntracked are the map's own hover-tooltip text,
    // mapSmallCountriesNote explains why very small nations only appear in
    // the checklist below, not as a clickable shape on the map itself.
    mapVisited: string;
    mapNotVisited: string;
    mapUntracked: string;
    mapSmallCountriesNote: string;
    // The Visualize tab row (components/Visited*.tsx) — Been-style
    // alternate views of the same underlying visited list, switched via
    // pill tabs alongside the default flat-map view.
    visualize: {
      tabMap: string;
      tabGlobe: string;
      tabZoomable: string;
      tabFlags: string;
      tabTimeline: string;
      tabChronology: string;
      tabPins: string;
      flagsEmpty: string;
      timelineEmpty: string;
      timelineDateUnknown: string;
      timelineSetDate: string;
      chronologyUndated: string;
      chronologyCountLabel: string; // "{count}" placeholder
      pinsHeading: string;
      pinsBlurb: string;
      pinsEmpty: string;
      pinsNeedVisitedCountry: string;
      pinFormCountryLabel: string;
      pinFormCountryPlaceholder: string;
      pinFormLabelLabel: string;
      pinFormLabelPlaceholder: string;
      pinFormLatLabel: string;
      pinFormLngLabel: string;
      pinFormNoteLabel: string;
      pinFormNotePlaceholder: string;
      pinFormSubmit: string;
      pinFormInvalid: string;
      pinRemove: string;
      zoomableHint: string;
    };
  };
  compareStats: {
    heading: string;
    yourStats: string;
    friendStats: string;
    missingLink: string;
    invalidLink: string;
    getYourLink: string;
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
  currencyLabel: "Currency",
  navMenuOpen: "Menu",
  navMenuClose: "Close",
  headlineLine1: "It doesn’t list options.",
  headlineLine2: "It decides for you.",
  subheadLine1: "Every line carries its own confidence - a verified fact, a single source, or an honest guess.",
  subheadLine2: "Never hidden, never overstated.",
  howItWorksSteps: {
    step1Title: "Tell us the trip",
    step1Body: "Destinations, dates, budget, pace - the things a friend would ask before planning.",
    step2Title: "We check real prices",
    step2Body: "Live search verifies accommodation and named venues instead of guessing.",
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
    "Cross-referencing accommodation costs…",
    "Confirming named venues are still open…",
    "Weighing options against your budget…",
    "Double-checking the numbers that matter…",
    "Putting the itinerary together…",
  ],
  form: {
    destinations: "Destinations (comma-separated)",
    destinationsPlaceholder: "Brussels, Bruges",
    compareToggleLabel: "Compare with another destination (same budget and preferences)",
    compareDestinations: "Compare against",
    compareDestinationsPlaceholder: "e.g. Athens",
    compareDifferentDatesLabel: "Use different dates for this destination (e.g. direct flights only run certain days)",
    compareDates: "Dates for the comparison destination",
    compareDatesPlaceholder: "Select start and end dates",
    origin: "Traveling from (optional)",
    originPlaceholder: "e.g. London - used to estimate real arrival/departure transport cost",
    skipLodgingLabel: "I already have accommodation sorted (e.g. business trip) - skip accommodation suggestions",
    accommodationLocation: "Where are you staying? (optional)",
    accommodationLocationPlaceholder: "e.g. Hotel Ibis, near Gare du Nord - helps plan routes and timing",
    skipFlightLabel: "I already have a flight/train booked - skip transport suggestions and cost",
    arrivalDate: "Arrival date (optional)",
    arrivalDatePlaceholder: "Select your arrival date",
    arrivalTime: "Arrival time (optional)",
    arrivalTimePlaceholder: "e.g. 8pm, or 'evening'",
    transportPreference: "Preferred way to get around (optional)",
    transportNoPreference: "No preference",
    transportPublicTransit: "Public transit (metro/bus/train)",
    transportTaxiRideshare: "Taxi / rideshare",
    transportWalking: "Walking where possible",
    dates: "Dates",
    datesPlaceholder: "Select start and end dates",
    datesPickEnd: "Now pick the end date",
    calendarPrevMonth: "Previous month",
    calendarNextMonth: "Next month",
    partySize: "Party size",
    partySizePlaceholder: "2",
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
    free: "Free",
    weather: {
      heading: "Weather outlook",
      historicalNote: "Some of these dates are beyond real forecast range - showing typical weather for these dates based on the last few years, not a forecast.",
      rainChance: "Rain",
      avgRain: "Avg rain",
    },
    googleRatingCount: "{count} reviews",
    closedTemporarily: "Temporarily closed (Google)",
    closedPermanently: "Permanently closed (Google)",
    viewOnGoogleMaps: "View on Google Maps",
    checkFlightPrices: "Check flight prices",
    trustScoreLabel: "verified",
    trustScoreDetail: "{grounded} of {total} line items are backed by a live search or a checked fact - the rest are honest, hedged guesses, not fabricated numbers.",
    downloadCalendar: "Add to calendar (.ics)",
    keyDecisions: "Key decisions",
    confidenceLevel: { high: "high", medium: "medium", low: "low" },
    vs: "vs",
    day: "Day",
    // "inferred" deliberately has no inline label (unlike single_source):
    // most non-lodging items are inferred by design (see SEARCH_INSTRUCTIONS
    // in worker/src/index.ts — meals/activities aren't price-searched), so
    // an "(unverified)" tag next to nearly every price read as the app
    // doubting itself on every line, undermining trust rather than earning
    // it. The confidence dot and the on-demand "How do we know this?" detail
    // still convey it honestly — just not shouted inline by default.
    inlineTierLabel: {
      single_source: "single source",
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
    didYouKnow: "Did you know?",
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
  whyDecide: {
    navLink: "Why decide?",
    pageTitle: "Why decide?",
    headlineLine1: "It's not a chatbot.",
    headlineLine2: "It's a decision.",
    subheadGeneric: "Ask a generic AI chatbot to plan a trip and you get a list to go research yourself.",
    subheadDecide: "Ask decide and you get an answer - checked, labeled, and ready to book.",
    columnHeadingGeneric: "A GENERIC AI CHATBOT",
    columnHeadingDecide: "DECIDE",
    rows: [
      {
        title: "Real prices, not a guess",
        generic: "States a number that sounds plausible, pulled from training data that's already out of date.",
        decide: "Checks live prices before it tells you anything. If it can't verify something, it says so instead of guessing.",
      },
      {
        title: "One answer, not a wall of options",
        generic: "Hands you five hotels and a shrug - you still have to pick one and check if it's actually good.",
        decide: "Picks one. That's the entire point of the product.",
      },
      {
        title: "Confidence you can actually see",
        generic: "Sounds equally sure about everything, whether it checked or made it up.",
        decide: "Every line is labeled: verified, single-source, or an honest guess. Never hidden, never overstated.",
      },
      {
        title: "Built for one job",
        generic: "A general-purpose chat window that happens to know some travel facts.",
        decide: "Built from the ground up to do exactly one thing: plan your trip.",
      },
      {
        title: "Budget math that's actually checked",
        generic: "Adds up numbers it invented five messages ago.",
        decide: "Flags it plainly - feasible or over budget - against real, checked costs.",
      },
    ],
    ctaHeading: "Stop chatting about your trip. Start deciding it.",
    ctaButton: "Plan my trip",
  },
  compare: {
    heading: "Which one actually works better?",
    totalCost: "Est. total cost",
    missingJobs: "This comparison link is missing one or both trips.",
    planAnother: "Plan a new comparison",
  },
  tripQA: {
    navLink: "Ask a Local",
    pageHeading: "Ask a Local",
    pageSubheading:
      "Packing, safety, local customs, whatever you're wondering about - ask anything, whether you planned the trip here or somewhere else.",
    sectionHeading: "Ask a local about this trip",
    placeholder: "What should I pack? Is it safe at night? Ask anything...",
    send: "Ask",
    sending: "Asking...",
    thinking: "Thinking...",
    genericError: "Something went wrong answering that. Try again.",
    tooLong: "That message is a bit long - try trimming it.",
    examplePrompts: [
      "What should I pack for Lisbon in October?",
      "Is it safe to walk around at night in Mexico City?",
      "What's a local custom I shouldn't accidentally break in Tokyo?",
      "Do I need to tip in Berlin restaurants?",
    ],
    topics: [
      { title: "Packing", body: "What to bring for the season, the climate, and what you're actually planning to do there." },
      { title: "Safety & practicalities", body: "Walking around at night, getting around town, money, SIM cards — the stuff you'd ask a friend who's already been." },
      { title: "Local customs", body: "Tipping, etiquette, what's normal — so you don't stand out for the wrong reasons." },
    ],
  },
  account: {
    navLink: "Pricing",
    headerSignIn: "Sign in",
    headerAccountLink: "Account",
    pricingHeading: "Plans",
    pricingSubheading:
      "Every visitor can try decide without an account. Sign in with an email to track your plan across visits, or subscribe for more generations a month.",
    valuePropsHeading: "Every plan gets the real thing",
    valueProps: [
      { title: "Budget feasibility, checked", body: "Every trip is checked against real, live costs — not numbers invented mid-conversation." },
      { title: "Confidence you can see", body: "Each recommendation is tagged grounded, inferred, or unverified, so you know what to double-check." },
      { title: "Ask a Local, anytime", body: "Packing, safety, local customs — unlimited questions, on both plans." },
    ],
    freePlanName: "Free",
    freePlanBlurb: "{count} generations a month, signed in with just an email — no card needed.",
    freePlanFeatures: [
      "{count} full itinerary generations a month",
      "Unlimited Ask a Local Q&A",
      "Budget feasibility check & trust score on every trip",
      "Destination guides, showcase & visited-countries tracker",
      "No card required — just an email",
    ],
    paidPlanName: "Pro",
    paidPlanBlurb: "{count} generations a month, plus you're directly supporting the real API costs behind every trip.",
    paidPlanFeaturesIntro: "Everything in Free, plus:",
    paidPlanFeatures: [
      "{count} generations a month — {multiplier}× the Free quota",
      "Room to plan (and compare) more than one trip a month",
      "Directly funds the real API costs behind every generation",
    ],
    paidPlanPrice: "€9/month",
    emailLabel: "EMAIL",
    emailPlaceholder: "you@example.com",
    emailMismatchNote: "Use the same email here that you'll sign in with below — that's how your plan gets linked to your account.",
    subscribeButton: "Subscribe",
    subscribing: "Starting checkout...",
    signInButton: "Email me a sign-in link",
    signInSent: "Check your email for a sign-in link.",
    accountHeading: "Your account",
    signedInAs: "Signed in as {email}",
    currentPlan: "Plan: {plan}",
    quotaUsed: "{used} of {limit} generations used this month",
    renewsOn: "Renews {date}",
    upgradeCta: "Upgrade to Pro →",
    signOutButton: "Sign out",
    notSignedIn: "Not signed in.",
    invalidLink: "That sign-in link is invalid or has expired — request a new one below.",
    genericError: "Something went wrong. Try again.",
  },
  visited: {
    navLink: "Places you've been →",
    homeNavLink: "Places you've been",
    pageHeading: "Places you've been",
    pageSubheading: "Mark the countries you've actually visited. Tap a country to toggle it.",
    statsCountries: "{count} countries visited",
    statsPercent: "{percent}% of the world",
    statsContinents: "{count} of {total} continents",
    signInPrompt: "Sign in to sync this list across devices — no password needed.",
    signInButton: "Email me a sign-in link",
    signInSent: "Check your email for a sign-in link.",
    badges: {
      first_stamp: "First stamp",
      explorer: "Explorer (10 countries)",
      globetrotter: "Globetrotter (25 countries)",
      continent_hopper: "Continent hopper (3 continents)",
      all_continents: "All continents",
      half_the_world: "Half the world",
    },
    backToAccount: "← Back to account",
    shareHeading: "Compare with a friend",
    shareBlurb: "Get a link to your stats, and compare it side by side with anyone who sends you theirs.",
    getShareLinkButton: "Get my share link",
    copyLinkButton: "Copy",
    linkCopied: "Copied!",
    compareInputLabel: "Paste a friend's share link",
    compareInputPlaceholder: "https://.../compare-stats?a=...",
    compareButton: "Compare",
    mapVisited: "Visited ✓",
    mapNotVisited: "Tap to mark visited",
    mapUntracked: "not tracked",
    mapSmallCountriesNote:
      "A few very small countries (city-states, small islands) don't show up as their own shape on the map above — mark them here instead.",
    visualize: {
      tabMap: "Map",
      tabGlobe: "Globe",
      tabZoomable: "Zoomable",
      tabFlags: "Flags",
      tabTimeline: "Timeline",
      tabChronology: "Chronology",
      tabPins: "Map Pins",
      flagsEmpty: "Mark a country visited and its flag shows up here.",
      timelineEmpty: "Mark a country visited to start your timeline.",
      timelineDateUnknown: "Date unknown",
      timelineSetDate: "Set the date",
      chronologyUndated: "Undated",
      chronologyCountLabel: "{count} countries",
      pinsHeading: "Pin exact places",
      pinsBlurb: "Drop a pin on a specific city or spot within a country you've visited — shown on the globe below.",
      pinsEmpty: "No pins yet. Add one below.",
      pinsNeedVisitedCountry: "Mark at least one country visited first — a pin belongs to a country you've been to.",
      pinFormCountryLabel: "Country",
      pinFormCountryPlaceholder: "Choose a visited country",
      pinFormLabelLabel: "Place name",
      pinFormLabelPlaceholder: "e.g. Shibuya Crossing",
      pinFormLatLabel: "Latitude",
      pinFormLngLabel: "Longitude",
      pinFormNoteLabel: "Note (optional)",
      pinFormNotePlaceholder: "Anything worth remembering",
      pinFormSubmit: "Add pin",
      pinFormInvalid: "Pick a country and a place name, with valid latitude/longitude.",
      pinRemove: "Remove",
      zoomableHint: "Pinch or scroll to zoom, drag to pan.",
    },
  },
  compareStats: {
    heading: "Travel stats, compared",
    yourStats: "Yours",
    friendStats: "Theirs",
    missingLink: "Get your own share link from the visited-places page to start a comparison.",
    invalidLink: "One of these share links isn't valid.",
    getYourLink: "Get your share link →",
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
  currencyLabel: "Валута",
  navMenuOpen: "Меню",
  navMenuClose: "Затвори",
  headlineLine1: "Без опции.",
  headlineLine2: "Решава вместо теб.",
  subheadLine1: "Всеки ред носи собствена увереност - факт, единствен източник или предположение.",
  subheadLine2: "Никога скрито, никога преувеличено.",
  howItWorksSteps: {
    step1Title: "Кажи ни за пътуването",
    step1Body: "Дестинации, дати, бюджет, темп - нещата, които приятел би попитал преди да планира.",
    step2Title: "Проверяваме реални цени",
    step2Body: "Търсене на живо потвърждава настаняване и конкретни места, вместо да гадаем.",
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
    compareToggleLabel: "Сравни с друга дестинация (същия бюджет и предпочитания)",
    compareDestinations: "Сравни със",
    compareDestinationsPlaceholder: "напр. Атина",
    compareDifferentDatesLabel: "Използвай различни дати за тази дестинация (напр. директни полети само в определени дни)",
    compareDates: "Дати за сравняваната дестинация",
    compareDatesPlaceholder: "Изберете начална и крайна дата",
    origin: "Заминаване от (по избор)",
    originPlaceholder:
      "напр. Лондон - използва се за оценка на реалната цена на транспорта при пристигане/заминаване",
    skipLodgingLabel: "Вече имам настаняване (напр. командировка) - пропусни предложенията за нощувка",
    accommodationLocation: "Къде отсядаш? (по избор)",
    accommodationLocationPlaceholder: "напр. хотел Ibis, до Gare du Nord - помага за маршрути и време",
    skipFlightLabel: "Вече имам резервиран полет/влак - пропусни предложенията и цената за транспорт",
    arrivalDate: "Дата на пристигане (по избор)",
    arrivalDatePlaceholder: "Избери дата на пристигане",
    arrivalTime: "Час на пристигане (по избор)",
    arrivalTimePlaceholder: "напр. 20:00, или 'вечерта'",
    transportPreference: "Предпочитан начин на придвижване (по избор)",
    transportNoPreference: "Без предпочитание",
    transportPublicTransit: "Градски транспорт (метро/автобус/влак)",
    transportTaxiRideshare: "Такси / рийдшеър",
    transportWalking: "Пеша, когато е възможно",
    dates: "Дати",
    datesPlaceholder: "Избери начална и крайна дата",
    datesPickEnd: "Сега избери крайната дата",
    calendarPrevMonth: "Предишен месец",
    calendarNextMonth: "Следващ месец",
    partySize: "Брой пътуващи",
    partySizePlaceholder: "2",
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
    free: "Безплатно",
    weather: {
      heading: "Прогноза за времето",
      historicalNote: "Част от тези дати са извън обхвата на реална прогноза - показваме типично време за тези дати въз основа на последните няколко години, не прогноза.",
      rainChance: "Дъжд",
      avgRain: "Ср. валежи",
    },
    googleRatingCount: "{count} отзива",
    closedTemporarily: "Временно затворено (Google)",
    closedPermanently: "Трайно затворено (Google)",
    viewOnGoogleMaps: "Виж в Google Maps",
    checkFlightPrices: "Провери цени на полети",
    trustScoreLabel: "проверено",
    trustScoreDetail: "{grounded} от {total} елемента са базирани на търсене на живо или проверен факт - останалите са честни, хеджирани предположения, не измислени цифри.",
    downloadCalendar: "Добави в календар (.ics)",
    keyDecisions: "Ключови решения",
    confidenceLevel: { high: "висока", medium: "средна", low: "ниска" },
    vs: "срещу",
    day: "Ден",
    inlineTierLabel: {
      single_source: "един източник",
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
    didYouKnow: "Знаете ли, че?",
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
  whyDecide: {
    navLink: "Защо decide?",
    pageTitle: "Защо decide?",
    headlineLine1: "Не е чатбот.",
    headlineLine2: "Е решение.",
    subheadGeneric: "Питаш обикновен AI чатбот да планира пътуване и получаваш списък за проучване.",
    subheadDecide: "Питаш decide и получаваш отговор - проверен, обозначен и готов за резервация.",
    columnHeadingGeneric: "ОБИКНОВЕН AI ЧАТБОТ",
    columnHeadingDecide: "DECIDE",
    rows: [
      {
        title: "Истински цени, не догадка",
        generic: "Дава число, което звучи правдоподобно, взето от вече остарели данни.",
        decide: "Проверява цени на живо, преди да каже каквото и да е. Ако не може да провери нещо, казва го открито, вместо да гадае.",
      },
      {
        title: "Един отговор, не купчина опции",
        generic: "Дава ти пет хотела и свиване на рамене - пак трябва сам да избереш и провериш дали е добър.",
        decide: "Избира един. Това е целият смисъл на продукта.",
      },
      {
        title: "Увереност, която виждаш",
        generic: "Звучи еднакво уверено за всичко, независимо дали е проверил или си го е измислил.",
        decide: "Всеки ред е обозначен: потвърдено, единичен източник или честно предположение. Никога скрито, никога преувеличено.",
      },
      {
        title: "Създаден за една задача",
        generic: "Общ чат прозорец, който случайно знае някои факти за пътувания.",
        decide: "Създаден от нулата да прави точно едно нещо: да планира твоето пътуване.",
      },
      {
        title: "Бюджетна математика, която наистина е проверена",
        generic: "Сумира числа, които си е измислил преди пет съобщения.",
        decide: "Ясно отбелязва - постижимо или над бюджета - спрямо реални, проверени разходи.",
      },
    ],
    ctaHeading: "Спри да обсъждаш пътуването си. Започни да го решаваш.",
    ctaButton: "Планирай пътуването ми",
  },
  compare: {
    heading: "Кое всъщност е по-добрият избор?",
    totalCost: "Прибл. обща цена",
    missingJobs: "На тази връзка за сравнение липсва едно или и двете пътувания.",
    planAnother: "Планирай ново сравнение",
  },
  tripQA: {
    navLink: "Питай местен",
    pageHeading: "Питай местен",
    pageSubheading:
      "Багаж, безопасност, местни обичаи, каквото ви интересува - попитайте за всичко, независимо дали пътуването е планирано тук или другаде.",
    sectionHeading: "Питай местен за това пътуване",
    placeholder: "Какво да си взема? Безопасно ли е вечер? Питайте каквото поискате...",
    send: "Питай",
    sending: "Изпращане...",
    thinking: "Мисля...",
    genericError: "Нещо се обърка при отговора. Опитайте отново.",
    tooLong: "Съобщението е малко дълго - опитайте да го съкратите.",
    examplePrompts: [
      "Какво да си взема за Лисабон през октомври?",
      "Безопасно ли е да се разхождам вечер в Мексико Сити?",
      "Кой местен обичай да внимавам да не наруша в Токио?",
      "Трябва ли да оставям бакшиш в ресторантите в Берлин?",
    ],
    topics: [
      { title: "Багаж", body: "Какво да вземете според сезона, климата и с какво всъщност ще се занимавате там." },
      { title: "Безопасност и практични съвети", body: "Разходки вечер, придвижване, пари, SIM карти - нещата, които бихте попитали приятел, който вече е бил там." },
      { title: "Местни обичаи", body: "Бакшиши, етикет, какво е нормално - за да не се откроявате по грешния начин." },
    ],
  },
  account: {
    navLink: "Цени",
    headerSignIn: "Вход",
    headerAccountLink: "Акаунт",
    pricingHeading: "Планове",
    pricingSubheading:
      "Всеки посетител може да пробва decide без акаунт. Влезте с имейл, за да следите плана си между посещенията, или се абонирайте за повече генерации на месец.",
    valuePropsHeading: "Всеки план получава истинското нещо",
    valueProps: [
      { title: "Проверена изпълнимост на бюджета", body: "Всяко пътуване се проверява спрямо реални, актуални цени - не измислени по средата на разговора числа." },
      { title: "Увереност, която виждате", body: "Всяка препоръка е обозначена като обоснована, изведена или непроверена, за да знаете какво да проверите допълнително." },
      { title: "Питай местен, по всяко време", body: "Багаж, безопасност, местни обичаи - неограничен брой въпроси, на двата плана." },
    ],
    freePlanName: "Безплатен",
    freePlanBlurb: "{count} генерации на месец, само с имейл - без карта.",
    freePlanFeatures: [
      "{count} пълни генерации на пътувания на месец",
      "Неограничени въпроси към Питай местен",
      "Проверка за изпълнимост на бюджета и ниво на доверие за всяко пътуване",
      "Гидове за дестинации, витрина и тракер на посетени държави",
      "Не се изисква карта - само имейл",
    ],
    paidPlanName: "Pro",
    paidPlanBlurb: "{count} генерации на месец, плюс директно подпомагате реалните разходи зад всяко пътуване.",
    paidPlanFeaturesIntro: "Всичко от Безплатния план, плюс:",
    paidPlanFeatures: [
      "{count} генерации на месец - {multiplier}× повече от безплатната квота",
      "Достатъчно за планиране (и сравняване) на повече от едно пътуване месечно",
      "Директно подпомагате реалните разходи зад всяка генерация",
    ],
    paidPlanPrice: "9€/месец",
    emailLabel: "ИМЕЙЛ",
    emailPlaceholder: "you@example.com",
    emailMismatchNote: "Използвайте същия имейл, с който ще влезете по-долу - така планът ви се свързва с акаунта ви.",
    subscribeButton: "Абонирай се",
    subscribing: "Стартиране на плащане...",
    signInButton: "Изпрати ми линк за вход",
    signInSent: "Проверете имейла си за линк за вход.",
    accountHeading: "Вашият акаунт",
    signedInAs: "Влезли сте като {email}",
    currentPlan: "План: {plan}",
    quotaUsed: "{used} от {limit} генерации използвани този месец",
    renewsOn: "Подновява се на {date}",
    upgradeCta: "Надградете до Pro →",
    signOutButton: "Изход",
    notSignedIn: "Не сте влезли.",
    invalidLink: "Този линк за вход е невалиден или е изтекъл - заявете нов по-долу.",
    genericError: "Нещо се обърка. Опитайте отново.",
  },
  visited: {
    navLink: "Места, които сте посетили →",
    homeNavLink: "Места, които сте посетили",
    pageHeading: "Места, които сте посетили",
    pageSubheading: "Отбележете държавите, които наистина сте посетили. Докоснете държава, за да превключите.",
    statsCountries: "{count} посетени държави",
    statsPercent: "{percent}% от света",
    statsContinents: "{count} от {total} континента",
    signInPrompt: "Влезте, за да синхронизирате списъка на други устройства - без парола.",
    signInButton: "Изпрати ми линк за вход",
    signInSent: "Проверете имейла си за линк за вход.",
    badges: {
      first_stamp: "Първи печат",
      explorer: "Изследовател (10 държави)",
      globetrotter: "Пътешественик (25 държави)",
      continent_hopper: "Между континентите (3 континента)",
      all_continents: "Всички континенти",
      half_the_world: "Половината свят",
    },
    backToAccount: "← Обратно към акаунта",
    shareHeading: "Сравнете с приятел",
    shareBlurb: "Получете линк към вашата статистика и я сравнете с всеки, който ви изпрати своята.",
    getShareLinkButton: "Вземи моя линк",
    copyLinkButton: "Копирай",
    linkCopied: "Копирано!",
    compareInputLabel: "Поставете линк на приятел",
    compareInputPlaceholder: "https://.../compare-stats?a=...",
    compareButton: "Сравни",
    mapVisited: "Посетено ✓",
    mapNotVisited: "Докоснете, за да отбележите",
    mapUntracked: "не се проследява",
    mapSmallCountriesNote:
      "Няколко много малки държави (градове-държави, малки острови) не се показват като отделна форма на картата по-горе - отбележете ги тук.",
    visualize: {
      tabMap: "Карта",
      tabGlobe: "Глобус",
      tabZoomable: "Мащабиране",
      tabFlags: "Флагове",
      tabTimeline: "Хронология",
      tabChronology: "По години",
      tabPins: "Пинове",
      flagsEmpty: "Отбележете държава като посетена и флагът ѝ ще се появи тук.",
      timelineEmpty: "Отбележете държава като посетена, за да започнете хронологията си.",
      timelineDateUnknown: "Неизвестна дата",
      timelineSetDate: "Задай дата",
      chronologyUndated: "Без дата",
      chronologyCountLabel: "{count} държави",
      pinsHeading: "Отбележете точни места",
      pinsBlurb: "Поставете пин на конкретен град или място в държава, която сте посетили — показва се на глобуса по-долу.",
      pinsEmpty: "Все още няма пинове. Добавете един по-долу.",
      pinsNeedVisitedCountry: "Първо отбележете поне една посетена държава — пинът принадлежи на държава, в която сте били.",
      pinFormCountryLabel: "Държава",
      pinFormCountryPlaceholder: "Изберете посетена държава",
      pinFormLabelLabel: "Име на мястото",
      pinFormLabelPlaceholder: "напр. Шибуя",
      pinFormLatLabel: "Ширина (lat)",
      pinFormLngLabel: "Дължина (lng)",
      pinFormNoteLabel: "Бележка (по избор)",
      pinFormNotePlaceholder: "Нещо, което си струва да запомните",
      pinFormSubmit: "Добави пин",
      pinFormInvalid: "Изберете държава и име на мястото, с валидни ширина/дължина.",
      pinRemove: "Премахни",
      zoomableHint: "Приближете с прищипване или скролиране, преместете с плъзгане.",
    },
  },
  compareStats: {
    heading: "Сравнение на статистиката",
    yourStats: "Вашата",
    friendStats: "Тяхната",
    missingLink: "Вземете своя линк от страницата за посетени места, за да започнете сравнение.",
    invalidLink: "Един от тези линкове не е валиден.",
    getYourLink: "Вземи своя линк →",
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
