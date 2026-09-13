// Who gets paid access, and which Stripe events are allowed to change it.
//
// The webhook is the only place that grants or revokes paid access, and it
// had no test, because driving a Next route means standing up its request
// plumbing and a Redis client that reads process.env. So the decision was
// extracted (lib/subscriptionEvent.ts) and this suite drives it directly.
//
// The two headline cases are written as TIMELINES rather than single calls,
// because neither bug is visible in one event - each one needs the sequence
// that produces it: cancel-then-resubscribe for the stale customer, and a
// 500-and-retry for the out-of-order event.
//
// Run: npm run test:subscription-event

import { getUserRecord, isPaidStatus, upsertUserRecord, type UserRecord } from "./account";
import { advancedEventClock, decideSubscriptionUpdate, type SubscriptionEventFacts } from "./subscriptionEvent";
import { check, finish, heading, section } from "./testutil";

heading("stripe subscription events and paid access");

const record = (over: Partial<UserRecord> = {}): UserRecord => ({
  email: "bob@example.com",
  stripeCustomerId: "cus_A",
  stripeSubscriptionId: "sub_A",
  subscriptionStatus: "active",
  currentPeriodEnd: 2_000_000_000,
  lastEventAt: 1_000,
  ...over,
});

const event = (over: Partial<SubscriptionEventFacts> = {}): SubscriptionEventFacts => ({
  customerId: "cus_A",
  subscriptionId: "sub_A",
  status: "active",
  currentPeriodEnd: 2_000_000_000,
  createdAt: 2_000,
  ...over,
});

/** Applies a decision the way the route does, so a timeline can be played
 * out against one evolving record. Returns the record unchanged when the
 * decision was to ignore the event - which is the whole point. */
function apply(current: UserRecord | null, facts: SubscriptionEventFacts): UserRecord | null {
  const decision = decideSubscriptionUpdate(current, facts);
  if (!decision.apply) return current;
  return {
    email: current?.email ?? "bob@example.com",
    stripeCustomerId: decision.fields.stripeCustomerId ?? null,
    stripeSubscriptionId: decision.fields.stripeSubscriptionId ?? null,
    subscriptionStatus: decision.fields.subscriptionStatus ?? null,
    currentPeriodEnd: decision.fields.currentPeriodEnd ?? null,
    lastEventAt: decision.fields.lastEventAt ?? null,
  };
}

async function main() {
  {
    section("the ordinary case still works");

    const d = decideSubscriptionUpdate(record(), event({ status: "past_due", createdAt: 3_000 }));
    check("an event about this account's own subscription applies", d.apply === true);
    if (d.apply) {
      check("  the status is written", d.fields.subscriptionStatus === "past_due");
      check("  the customer id is written too", d.fields.stripeCustomerId === "cus_A");
      check("  and the clock advances", d.fields.lastEventAt === 3_000);
    }

    // past_due keeps access during Stripe's retry window - asserted here
    // because the decision and the access rule have to agree.
    check("past_due still counts as paid", isPaidStatus("past_due"));
    check("canceled does not", isPaidStatus("canceled") === false);
  }

  {
    section("a record that does not exist yet");

    // The reverse index is only written at checkout, so an email in it did
    // check out. Applying writes the customer id, which the old handler
    // never did - so the record was a status with no subscription behind it.
    const d = decideSubscriptionUpdate(null, event());
    check("applies, rather than being dropped", d.apply === true);
    check("and writes a coherent record", d.apply && d.fields.stripeCustomerId === "cus_A");
  }

  {
    section("THE STALE CUSTOMER: cancel, resubscribe, then the dead customer's event");

    // /api/checkout passes customer_email and no customer, so every
    // checkout mints a NEW Stripe customer. This is the timeline that
    // produced a paying traveller with no access.
    let live: UserRecord | null = record({ stripeCustomerId: "cus_A", stripeSubscriptionId: "sub_A" });

    // They cancel. Real event about the real subscription.
    live = apply(live, event({ status: "canceled", createdAt: 2_000 }));
    check("cancelling works", live?.subscriptionStatus === "canceled");

    // They resubscribe: new checkout, new customer, new subscription. That
    // write is handleCheckoutCompleted's, which is exempt by design.
    live = {
      ...record(),
      stripeCustomerId: "cus_B",
      stripeSubscriptionId: "sub_B",
      subscriptionStatus: "active",
      lastEventAt: advancedEventClock(live, 3_000),
    };
    check("resubscribing grants access", live.subscriptionStatus === "active");
    check("  under the new customer", live.stripeCustomerId === "cus_B");

    // Now anything at all about the DEAD customer. Stripe still sends
    // these, and stripeCustomer:cus_A -> email has no TTL, so it still
    // resolves to this account.
    const deadCustomerEvent = event({
      customerId: "cus_A",
      subscriptionId: "sub_A",
      status: "canceled",
      createdAt: 4_000,
    });
    const decision = decideSubscriptionUpdate(live, deadCustomerEvent);
    check("the dead customer's event is refused", decision.apply === false);
    check(
      "  and says which customer it was about",
      decision.apply === false && decision.reason.includes("cus_A") && decision.reason.includes("cus_B")
    );

    const after = apply(live, deadCustomerEvent);
    check("so the live subscription is untouched", after?.subscriptionStatus === "active");
    check("  still on the new customer", after?.stripeCustomerId === "cus_B");
    check("  and still paid", isPaidStatus(after?.subscriptionStatus ?? null));
  }

  {
    section("a stale SUBSCRIPTION under the same customer");

    // Narrower than the case above and refused for its own reason, because
    // a record can carry one identity without the other.
    const live = record({ stripeCustomerId: "cus_A", stripeSubscriptionId: "sub_B" });
    const d = decideSubscriptionUpdate(live, event({ subscriptionId: "sub_A", status: "canceled" }));
    check("an event about the replaced subscription is refused", d.apply === false);
    check("  naming both", d.apply === false && d.reason.includes("sub_A") && d.reason.includes("sub_B"));

    // ...but a record with a customer and NO subscription id is a checkout
    // that completed before its subscription existed, and this event is
    // its first real news.
    const pending = record({ stripeSubscriptionId: null });
    const first = decideSubscriptionUpdate(pending, event({ subscriptionId: "sub_Z" }));
    check("a record with no subscription id accepts the first one", first.apply === true);
    check("  and records it", first.apply && first.fields.stripeSubscriptionId === "sub_Z");
  }

  {
    section("THE RETRIED EVENT: a 500 means Stripe delivers it again, later");

    // This route returns 500 on a Redis hiccup so Stripe WILL retry - that
    // is its own documented behaviour, not a hypothetical. By the time the
    // retry lands, later events have been applied.
    let live: UserRecord | null = record({ subscriptionStatus: "active", lastEventAt: 1_000 });

    // t=5000: they cancel. Applied.
    live = apply(live, event({ status: "canceled", createdAt: 5_000 }));
    check("the cancellation applies", live?.subscriptionStatus === "canceled");
    check("  and moves the clock to 5000", live?.lastEventAt === 5_000);

    // t=4000, delivered now: the retried "active" from before the cancel.
    const retried = event({ status: "active", createdAt: 4_000 });
    const d = decideSubscriptionUpdate(live, retried);
    check("the retried older event is refused", d.apply === false);
    check(
      "  and says which timestamps",
      d.apply === false && d.reason.includes("4000") && d.reason.includes("5000")
    );

    const after = apply(live, retried);
    check("so access is NOT re-granted", after?.subscriptionStatus === "canceled");
    check("  and stays unpaid", isPaidStatus(after?.subscriptionStatus ?? null) === false);
  }

  {
    section("the clock boundary");

    // Strictly older is refused; EQUAL is applied. Two Stripe events can
    // share a `created` second, and refusing an equal one would drop a real
    // update.
    const live = record({ lastEventAt: 5_000 });
    check("older is refused", decideSubscriptionUpdate(live, event({ createdAt: 4_999 })).apply === false);
    check("equal is applied", decideSubscriptionUpdate(live, event({ createdAt: 5_000 })).apply === true);
    check("newer is applied", decideSubscriptionUpdate(live, event({ createdAt: 5_001 })).apply === true);

    // A record written before lastEventAt existed has none, and must not
    // be locked out by its own absence.
    const legacy = record({ lastEventAt: null });
    check("a record with no clock accepts any event", decideSubscriptionUpdate(legacy, event({ createdAt: 1 })).apply === true);
  }

  {
    section("the clock only ever moves forwards");

    check("a newer checkout advances it", advancedEventClock(record({ lastEventAt: 1_000 }), 2_000) === 2_000);
    check("an older one does not lower it", advancedEventClock(record({ lastEventAt: 5_000 }), 2_000) === 5_000);
    check("a record with no clock takes the event's", advancedEventClock(record({ lastEventAt: null }), 2_000) === 2_000);
    check("no record at all takes the event's", advancedEventClock(null, 2_000) === 2_000);
    check("a NaN timestamp leaves it alone", advancedEventClock(record({ lastEventAt: 7_000 }), Number.NaN) === 7_000);
    check("and with no record, NaN reads as zero rather than NaN", advancedEventClock(null, Number.NaN) === 0);
  }

  {
    section("an event that cannot be reasoned about");

    // Guessing here means writing a status against the wrong identity.
    for (const [label, facts] of [
      ["no customer", event({ customerId: "" })],
      ["a blank customer", event({ customerId: "   " })],
      ["no subscription", event({ subscriptionId: "" })],
      ["a NaN timestamp", event({ createdAt: Number.NaN })],
      ["an Infinity timestamp", event({ createdAt: Infinity })],
    ] as [string, SubscriptionEventFacts][]) {
      const d = decideSubscriptionUpdate(record(), facts);
      check(`an event with ${label} is refused`, d.apply === false);
    }

    // ...including against a null record, where there is no identity to
    // compare with and the temptation to just write it is strongest.
    check(
      "even with no record to contradict it",
      decideSubscriptionUpdate(null, event({ customerId: "" })).apply === false
    );
  }

  {
    section("reading the record back out of a Redis hash");

    // Redis hashes have no null, so upsertUserRecord stores a null field as
    // the EMPTY STRING - and getUserRecord read it back with
    // `data.x ?? null`, which replaces only null and undefined. So a field
    // that had been explicitly cleared came back as "" and every
    // `=== null` test on it was false: the stale-customer guard above would
    // have compared "" to a real customer id and refused a legitimate
    // event on a cleared record.
    const hash = (data: Record<string, string>) =>
      ({ hgetall: async () => data }) as unknown as Parameters<typeof getUserRecord>[0];

    const cleared = await getUserRecord(hash({ subscriptionStatus: "", stripeCustomerId: "", currentPeriodEnd: "" }), "bob@example.com");
    check("a cleared status reads as null, not an empty string", cleared?.subscriptionStatus === null, JSON.stringify(cleared?.subscriptionStatus));
    check("  a cleared customer id too", cleared?.stripeCustomerId === null);
    check("  and a cleared period end", cleared?.currentPeriodEnd === null);

    const whitespace = await getUserRecord(hash({ stripeSubscriptionId: "   " }), "bob@example.com");
    check("a whitespace-only field is null as well", whitespace?.stripeSubscriptionId === null);

    // `Number("")` is 0 and `Number("later")` is NaN, and both used to land
    // straight on the record - 0 reads as a subscription that ended in
    // 1970, and NaN reaches `new Date(NaN * 1000)` on the account page.
    for (const [label, raw] of [
      ["a non-numeric", "later"],
      ["a zero", "0"],
      ["a negative", "-5"],
    ] as [string, string][]) {
      const read = await getUserRecord(hash({ currentPeriodEnd: raw, lastEventAt: raw }), "bob@example.com");
      check(`${label} period end reads as null`, read?.currentPeriodEnd === null, String(read?.currentPeriodEnd));
      check(`  and so does the clock`, read?.lastEventAt === null);
    }

    const good = await getUserRecord(
      hash({ subscriptionStatus: "active", currentPeriodEnd: "2000000000", lastEventAt: "5000" }),
      "BOB@Example.com "
    );
    check("a real record reads through", good?.subscriptionStatus === "active");
    check("  with its period end as a number", good?.currentPeriodEnd === 2_000_000_000);
    check("  and its clock", good?.lastEventAt === 5_000);
    check("  under a normalized email", good?.email === "bob@example.com", String(good?.email));

    check("an empty hash is no record at all", (await getUserRecord(hash({}), "bob@example.com")) === null);

    // And the round trip: what upsertUserRecord writes is what getUserRecord
    // reads. This is the pair that drifted.
    const written: Record<string, string> = {};
    const store = {
      hset: async (_key: string, fields: Record<string, string>) => {
        Object.assign(written, fields);
      },
      hgetall: async () => written,
    } as unknown as Parameters<typeof upsertUserRecord>[0];
    await upsertUserRecord(store, "bob@example.com", {
      subscriptionStatus: null,
      lastEventAt: 5_000,
      currentPeriodEnd: 2_000_000_000,
    });
    check("a null written as \"\" comes back as null", (await getUserRecord(store, "bob@example.com"))?.subscriptionStatus === null);
    check("  and the numbers survive the round trip", (await getUserRecord(store, "bob@example.com"))?.lastEventAt === 5_000);
  }

  finish();
}

void main();
