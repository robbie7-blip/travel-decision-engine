// Plan quota numbers — split out from account.ts specifically so client
// components (the pricing page) can import just these two constants
// without pulling account.ts's Redis-calling code into the browser bundle.
//
// NEXT_PUBLIC_-prefixed so Next.js inlines the value into the client
// bundle at build time; a plain (unprefixed) env var read from a client
// component would just be undefined in the browser, silently falling back
// to the default and drifting from whatever the server actually enforces.
// Using the same var name server-side too (account.ts imports these, not
// its own separate reads) means there's exactly one source of truth — the
// displayed number can never disagree with the enforced one.
export const FREE_MONTHLY_GENERATIONS = Number(process.env.NEXT_PUBLIC_FREE_MONTHLY_GENERATIONS ?? 5);
export const PAID_MONTHLY_GENERATIONS = Number(process.env.NEXT_PUBLIC_PAID_MONTHLY_GENERATIONS ?? 60);
