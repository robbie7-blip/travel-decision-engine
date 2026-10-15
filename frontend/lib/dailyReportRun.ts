// Builds yesterday's report (lib/dailyReport.ts) from the archive and,
// when asked, emails it.
//
// The recipient is ADMIN_REPORT_EMAIL and nothing else: no route that
// calls this takes an address, so a request can never point the report -
// which lists real trips - somewhere new.

import { getDb } from "./db";
import { listAdminTrips } from "./tripsQuery";
import { buildDailyReport, type DailyReport } from "./dailyReport";
import { sendItineraryEmail } from "./email";
import { getSiteUrl } from "./siteUrl";

export type DailyReportRun =
  | { ok: true; report: DailyReport; sent: boolean }
  | { ok: false; detail: string };

export async function runDailyReport({ send }: { send: boolean }): Promise<DailyReportRun> {
  const db = getDb();
  if (!db) return { ok: false, detail: "DATABASE_URL is not set, so there is nothing to report on." };
  let report: DailyReport;
  try {
    report = buildDailyReport(await listAdminTrips(db, 1000, true, 24), getSiteUrl());
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).replace(/postgres(?:ql)?:\/\/\S+/gi, "[connection string]");
    return { ok: false, detail: `Could not read trips: ${message.slice(0, 200)}` };
  }
  if (!send) return { ok: true, report, sent: false };

  const to = process.env.ADMIN_REPORT_EMAIL?.trim();
  if (!to) return { ok: false, detail: "ADMIN_REPORT_EMAIL is not set, so there is nowhere to send it." };
  try {
    // The same Resend sender the trip emails use: an HTML message to one
    // address, which is all this needs.
    await sendItineraryEmail(to, report.subject, report.html);
  } catch (e) {
    return { ok: false, detail: `Could not send: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, report, sent: true };
}
