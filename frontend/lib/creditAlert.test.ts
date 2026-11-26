// Run: npm run test:credit-alert

import Anthropic from "@anthropic-ai/sdk";
import { isOutOfCredit } from "./creditAlert";
import { check, finish, heading } from "./testutil";

function apiError(status: number, message: string) {
  return Anthropic.APIError.generate(status, { type: "error", error: { type: "invalid_request_error", message } }, message, new Headers());
}

heading("Out of credit is recognised");
check("the credit 400", isOutOfCredit(apiError(400, "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.")));
check("another 400 is not", !isOutOfCredit(apiError(400, "messages: first message must use the user role")));
check("an overload is not", !isOutOfCredit(apiError(529, "Overloaded")));
check("a plain error is not", !isOutOfCredit(new Error("credit balance is too low")));
finish();
