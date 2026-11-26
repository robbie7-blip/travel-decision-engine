// Run: npm run test:ask-model-history

import { historyForModel, NOT_AN_ANSWER } from "./askModelHistory";
import type { TripQAMessage } from "./tripQA";
import { check, finish, heading } from "./testutil";

function chat(questions: number): TripQAMessage[] {
  const out: TripQAMessage[] = [];
  for (let i = 1; i <= questions; i++) {
    out.push({ role: "user", content: `q${i}` });
    if (i < questions) out.push({ role: "assistant", content: `a${i}` });
  }
  return out;
}

heading("A long chat still starts with a question");
for (const n of [1, 5, 10, 11, 12, 30]) {
  const h = historyForModel(chat(n));
  check(`${n} questions: starts with a question, ends with the newest`, h[0]?.role === "user" && h[h.length - 1]?.content === `q${n}`, JSON.stringify(h.map((m) => m.content)));
  check(`${n} questions: at most 20 messages`, h.length <= 20);
}
const eleven = historyForModel(chat(11));
check("11 questions: the window drops the leading answer", eleven[0].content === "q2" && eleven.length === 19);

heading("Failure replies are left out");
const failed: TripQAMessage[] = [
  { role: "user", content: "clean beach?" },
  { role: "assistant", content: NOT_AN_ANSWER[0] },
  { role: "user", content: "?" },
];
const h = historyForModel(failed);
check("only the questions remain", h.length === 2 && h.every((m) => m.role === "user"));
check("Bulgarian too", historyForModel([{ role: "user", content: "a" }, { role: "assistant", content: NOT_AN_ANSWER[1] }, { role: "user", content: "b" }]).length === 2);
check("a real answer stays", historyForModel([{ role: "user", content: "a" }, { role: "assistant", content: "Go to Balos." }, { role: "user", content: "b" }]).length === 3);
finish();
