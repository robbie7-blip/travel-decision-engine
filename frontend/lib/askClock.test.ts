// Run: npm run test:ask-clock

import { FALLBACK_TIME_ZONE, nowLine, safeTimeZone } from "./askClock";
import { check, finish, heading } from "./testutil";

heading("Ask a Local knows the date");
const at = new Date("2026-11-19T19:40:00Z");
check("Sofia's date, weekday and time", nowLine("Europe/Sofia", at).includes("Thursday, 19 November 2026") && nowLine("Europe/Sofia", at).includes("21:40"), nowLine("Europe/Sofia", at));
check("with UTC beside it", nowLine("Europe/Sofia", at).includes("2026-11-19 19:40 UTC"));
check("the traveller's own zone", nowLine("America/New_York", at).includes("14:40") && nowLine("America/New_York", at).includes("America/New_York"));
check("across midnight, the local date", nowLine("Asia/Tokyo", new Date("2026-11-19T16:30:00Z")).includes("Friday, 20 November 2026"));
check("an unknown zone falls back to Sofia", safeTimeZone("Mars/Base") === FALLBACK_TIME_ZONE);
check("nonsense falls back to Sofia", safeTimeZone("x; drop table") === FALLBACK_TIME_ZONE && safeTimeZone(42) === FALLBACK_TIME_ZONE);
finish();
