// One place that knows how to build an Anthropic client, because there are
// three of them (the worker, /api/trip-questions, /api/flight-import) and
// the thing they have to agree on is invisible until it fails.
//
// Anthropic has two kinds of API key. A WORKSPACE key is bound to one
// workspace, so the server already knows which workspace a request acts in.
// An IDENTITY-LINKED key is not bound to anything, and every request made
// with one must name its workspace in an `anthropic-workspace-id` header —
// without it the API returns:
//
//   400 invalid_request_error — "anthropic-workspace-id is required when
//   authenticating with an identity-linked API key; send the id of the
//   workspace this request acts in."
//
// This cost most of a morning to find. The two key types look identical
// where you paste them, the failure arrives as a 400 rather than an auth
// error, and it surfaces at the model call rather than at startup — so it
// reads as "the request is malformed" when the request is fine and the
// credential simply needs one more field. Rotating an expired workspace key
// to a new identity-linked one is enough to trigger it, with nothing in the
// diff to blame.
//
// Set ANTHROPIC_WORKSPACE_ID (Console → Settings → Workspaces → the
// workspace → its id, `wrkspc_...`) and every call carries the header. Leave
// it unset and nothing is sent, which is correct for a workspace key.

import Anthropic from "@anthropic-ai/sdk";

/** The workspace this process acts in, or null when the key doesn't need
 * one. Trimmed because a value pasted into a hosting dashboard picks up
 * whitespace far more often than anyone expects, and a header with a
 * trailing newline fails in a way that looks nothing like its cause. */
export function workspaceId(): string | null {
  const raw = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return raw ? raw : null;
}

type ClientOptions = ConstructorParameters<typeof Anthropic>[0];

/** Builds a client, adding the workspace header when one is configured.
 * Pass any other option (timeout, maxRetries) through as normal. */
export function createAnthropicClient(options: ClientOptions & { apiKey: string }): Anthropic {
  const id = workspaceId();
  return new Anthropic({
    ...options,
    ...(id ? { defaultHeaders: { ...options.defaultHeaders, "anthropic-workspace-id": id } } : {}),
  });
}

/** True when the error is the missing-workspace-header 400 above.
 *
 * Worth naming rather than letting it surface as a generic "model provider
 * error": it is a configuration problem with an exact fix, and the generic
 * wording sends whoever reads it looking through the request-building code,
 * which is the one place the problem is not. */
export function isMissingWorkspaceIdError(e: unknown): boolean {
  return (
    e instanceof Anthropic.BadRequestError &&
    /anthropic-workspace-id is required/i.test(e.message ?? "")
  );
}
