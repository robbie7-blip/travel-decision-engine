// Travelpayouts Drive: turns plain links to partner sites on the page (the
// Omio train links, for one) into affiliate links.
//
// In the HTML of every page, from the root layout, because Travelpayouts
// verifies the install by finding its loader on the homepage - a script
// Next injects from the browser (next/script's lazyOnload) is never in
// the HTML it reads. The loader is a few lines and waits for the page's
// own load event before fetching anything, so it never delays what a
// visitor sees.
//
// The id is the account's public Drive id, the same one every visitor's
// browser downloads; it is not a secret. Which brands Drive may rewrite
// is set in the Travelpayouts dashboard: links that already earn through
// CJ (Booking.com) or GetYourGuide's own programme are excluded there.

const DRIVE_SRC = "https://tpembars.com/NTg2MDM3.js?t=586037";

const LOADER = `(function () {
  function load() {
    var script = document.createElement("script");
    script.async = 1;
    script.setAttribute("data-cmp-ab", "2");
    script.src = ${JSON.stringify(DRIVE_SRC)};
    document.head.appendChild(script);
  }
  if (document.readyState === "complete") load();
  else window.addEventListener("load", load, { once: true });
})();`;

export function TravelpayoutsDrive() {
  return <script id="tp-drive" data-cmp-ab="2" dangerouslySetInnerHTML={{ __html: LOADER }} />;
}
