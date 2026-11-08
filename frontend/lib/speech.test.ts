// Run: npm run test:speech

import { canListen, canSpeak, createRecognizer, pickVoice, speakableText, transcriptOf } from "./speech";
import { check, finish, heading, section } from "./testutil";

heading("speaking to Ask a Local");

section("what the browser offers");
{
  class Fake {}
  check("prefixed recognition counts", canListen({ webkitSpeechRecognition: Fake }) && createRecognizer({ webkitSpeechRecognition: Fake }) instanceof Fake);
  check("no recognition, no microphone button", !canListen({}) && createRecognizer({}) === null);
  check("reading aloud needs both halves", canSpeak({ speechSynthesis: {}, SpeechSynthesisUtterance: Fake }) && !canSpeak({ speechSynthesis: {} }));
  check("no window at all is not a crash", !canListen(undefined) && !canSpeak(undefined));
}

section("what was heard");
{
  const r = (t: string) => [{ transcript: t }];
  check("phrases are joined", transcriptOf([r("what should I pack"), r(" for Rome in May ")]) === "what should I pack for Rome in May");
  check("nothing heard is empty", transcriptOf([]) === "");
}

section("what is read out");
{
  check("place markers are read as names", speakableText("Try [[Roscioli]] for carbonara.") === "Try Roscioli for carbonara.");
  check("links are read as their words", speakableText("See [the museum](https://example.com/x) first.") === "See the museum first.");
  check("bare addresses are not read", speakableText("Book at https://example.com/tickets today.") === "Book at today.");
  check("Markdown is not read", speakableText("**Bring** a *jacket*\n- shoes") === "Bring a jacket shoes");
}

section("the voice");
{
  const voices = [
    { lang: "en-US", name: "Fred", localService: true },
    { lang: "en-GB", name: "Google UK English Female" },
    { lang: "bg-BG", name: "Daria" },
  ];
  check("British English, the better voice", pickVoice(voices, "en")?.name === "Google UK English Female");
  check("Bulgarian when there is one", pickVoice(voices, "bg")?.name === "Daria");
  check("none for the language, let the browser choose", pickVoice([{ lang: "en-US", name: "Fred" }], "bg") === null);
}

finish();
