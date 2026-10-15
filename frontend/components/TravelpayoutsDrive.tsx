"use client";

// Travelpayouts Drive: turns plain links to partner sites on the page (the
// Omio train links, for one) into affiliate links. Loaded only on the
// pages that carry booking links - a trip and a published trip - and only
// after the page has finished loading, so it costs nothing on the
// homepage or on how fast a trip appears.
//
// The id is the account's public Drive id, the same one every visitor's
// browser downloads; it is not a secret. Which brands Drive may rewrite
// is set in the Travelpayouts dashboard: links that already earn through
// CJ (Booking.com) or GetYourGuide's own programme are excluded there.

import Script from "next/script";

const DRIVE_SRC = "https://tpembars.com/NTg2MDM3.js?t=586037";

export function TravelpayoutsDrive() {
  return <Script id="tp-drive" src={DRIVE_SRC} strategy="lazyOnload" data-cmp-ab="2" />;
}
