// Plan quota numbers - split out from account.ts specifically so client
// components (the pricing page) can import just these two constants
// without pulling account.ts's Redis-calling code into the browser bundle.
//
// NEXT_PUBLIC_-prefixed so Next.js inlines the value into the client
// bundle at build time; a plain (unprefixed) env var read from a client
// component would just be undefined in the browser, silently falling back
// to the default and drifting from whatever the server actually enforces.
// Using the same var name server-side too (account.ts imports these, not
// its own separate reads) means there's exactly one source of truth - the
// displayed number can never disagree with the enforced one.
//
// Read through positiveIntOr rather than Number(): these two numbers are
// both ENFORCED (account.ts) and DISPLAYED (the pricing page, and the
// "you've used all N" message at the cap). Number("") is 0 and Number("6o")
// is NaN, so an env var set to an empty string in the Vercel dashboard - a
// single stray save on a field that looks blank either way - locked every
// account out of generating with "You've used all 0 free generations this
// month", while the pricing page advertised 0. There is no error path for
// that; it just becomes the product's behaviour. The helper falls back to
// the default instead.
//
// The value is passed in rather than the var name because Next.js inlines
// NEXT_PUBLIC_* by literal text substitution at build time - see the note
// on positiveIntOr.
import { positiveIntOr } from "./envNumber";

// The plans (app/pricing): a trip without an account, a few more a month
// signed in for free, then the Traveller subscription, billed monthly or
// (for less than half the price) yearly. Most people plan a handful of trips a year, so a
// big monthly allowance sold nothing anyone needed.
export const FREE_MONTHLY_GENERATIONS = positiveIntOr(process.env.NEXT_PUBLIC_FREE_MONTHLY_GENERATIONS, 2);
export const PAID_MONTHLY_GENERATIONS = positiveIntOr(process.env.NEXT_PUBLIC_PAID_MONTHLY_GENERATIONS, 10);
/** Trips a month from one connection without signing in. */
export const ANON_MONTHLY_GENERATIONS = positiveIntOr(process.env.NEXT_PUBLIC_ANON_MONTHLY_GENERATIONS, 1);

/** What the pricing page shows; Stripe charges what its prices say, so
 * these must match the prices created there. */
export const MONTHLY_PRICE = { en: "€4.99", bg: "4,99 €" } as const;
export const ANNUAL_PRICE = { en: "€29", bg: "29 €" } as const;
