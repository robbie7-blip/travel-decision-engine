// Which part of an Ask a Local conversation goes to the model.
//
// The page keeps the whole chat; the route sends only the newest
// MAX_TRIP_QA_HISTORY messages. A plain slice of the newest twenty broke
// every long chat: a chat alternates question, answer, question, so once it
// passes ten questions the newest twenty start with an ANSWER, and the API
// refuses a conversation that opens with the assistant. Both attempts failed
// the same way, the traveler read "I'm a little overloaded" and so did every
// question after it, "?" included.
//
// So the window starts at a question. Also left out: the replies that only
// said something went wrong, which are not answers and would only teach the
// model to repeat them.
//
// Run: npm run test:ask-model-history

import { MAX_TRIP_QA_HISTORY, type TripQAMessage } from "./tripQA";

/** Texts the route sends when it could not answer. Not part of the
 * conversation the model should see. */
export const NOT_AN_ANSWER = [
  "Give me a second and try asking again, I'm a little overloaded right now.",
  "Дай ми секунда и опитай пак, в момента съм малко претоварен.",
  "Ask a Local is temporarily unavailable. That's a problem on our side, not with your question.",
  "„Питай местен“ временно не работи. Проблемът е при нас, не във въпроса ти.",
];

/** The newest messages, starting with a question, without failure replies. */
export function historyForModel(messages: TripQAMessage[], max = MAX_TRIP_QA_HISTORY): TripQAMessage[] {
  const answered = messages.filter(
    (m) => !(m.role === "assistant" && NOT_AN_ANSWER.includes(m.content.trim()))
  );
  const recent = answered.slice(-max);
  const firstQuestion = recent.findIndex((m) => m.role === "user");
  return firstQuestion < 0 ? [] : recent.slice(firstQuestion);
}
