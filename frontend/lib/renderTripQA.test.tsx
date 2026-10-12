// Ask a Local's photo button, and the one attribute that must not come
// back.
//
// WHY THIS EXISTS. The hidden file input carried capture="environment".
// That was chosen deliberately, to open the rear camera in one tap - the
// moment the feature is for, standing in front of the thing you are asking
// about - and the comment above it said so.
//
// On iOS, `capture` does not mean "default to the camera". It means CAMERA
// ONLY: Safari skips its own sheet and goes straight to a live viewfinder,
// with no Photo Library and no Choose File. So the commonest thing anyone
// would want to ask about could not be attached AT ALL - a screenshot of a
// booking confirmation, a photo of a menu taken at lunch and asked about
// on the walk home, a picture somebody sent. The owner found it on a
// phone: "why can't I attach a photo but can only take a photo".
//
// It needs a test rather than a comment because the failure is invisible
// from every side except an iPhone. The attribute is five characters in a
// file of eight hundred lines, the input is display:none so nothing
// renders differently, the desktop browsers every other check runs in
// ignore it completely, and check:a11y-names deliberately skips the input
// for being hidden. Nothing in this repo could see it, and nothing would
// see it come back.
//
// Rendered with react-dom/server, like the two suites next to it, so there
// is no browser and no jsdom: the question is what the markup SAYS, and
// the markup is a string.
//
// Run: npm run test:render-trip-qa

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TripQA } from "../components/TripQA";
import { TRANSLATIONS } from "./i18n";
import { check, finish, heading, section } from "./testutil";

heading("Ask a Local's photo button");

const markup = renderToStaticMarkup(<TripQA language="en" t={TRANSLATIONS.en} saveHistory />);

/** The hidden file input's own tag, on its own. */
const fileInput = (() => {
  const match = markup.match(/<input[^>]*type="file"[^>]*>/);
  return match ? match[0] : "";
})();

section("the file input");

check("there is one", fileInput !== "", markup.slice(0, 300));

// THE WHOLE POINT OF THIS FILE.
check(
  'it does NOT carry `capture`, so iOS offers the photo library as well as the camera',
  !/\bcapture\b/.test(fileInput),
  fileInput
);

check("it still accepts images", /accept="image\/\*"/.test(fileInput), fileInput);

check(
  "and it is still hidden, because a visible button opens it",
  /display:\s*none/.test(fileInput),
  fileInput
);

section("the button that opens it");

// Hidden input, visible proxy: the control a traveler actually taps has to
// be named, because the input it stands in for announces nothing.
check(
  "is named for a screen reader",
  markup.includes(`aria-label="${TRANSLATIONS.en.tripQA.addPhoto}"`),
  "no aria-label matching tripQA.addPhoto"
);

// "Add photo", not "Take photo", in both languages - the button does both
// now, and naming it after the camera would advertise the smaller half.
for (const language of ["en", "bg"] as const) {
  const label = TRANSLATIONS[language].tripQA.addPhoto.toLowerCase();
  check(
    `its ${language} label does not say "take"`,
    !label.includes("take") && !label.includes("снимай") && !label.includes("заснем"),
    TRANSLATIONS[language].tripQA.addPhoto
  );
}

section("the composer around it");

check(
  "the ask box is still the 16px field iOS needs before it will let you type without zooming",
  markup.includes("trip-qa-input"),
  "no .trip-qa-input in the markup"
);
check(
  "and it is labelled in its own words, not by the placeholder",
  markup.includes(`aria-label="${TRANSLATIONS.en.tripQA.inputLabel}"`),
  "no aria-label matching tripQA.inputLabel"
);

section("a fresh visit");

// The saved-chats bar renders only once there is something to show, and
// nothing is shown on the server: localStorage is read in an effect, which
// react-dom/server never runs. So a first paint must not contain it, or it
// would flash in and out on every load.
check(
  "has no saved-chats bar in the first paint",
  !markup.includes("ask-history-toggle"),
  "the history bar rendered on the server"
);

finish();
