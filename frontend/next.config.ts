import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /spin moved to /decide-for-me.
  //
  // The old path was named after the wheel, back when the wheel was the
  // whole feature. The dart and the globe are the default now and the
  // wheel is the alternative behind them, so the URL described something
  // the page no longer leads with - and the new name deliberately names
  // the JOB rather than the mechanism, because the mechanism has already
  // changed once and a path cannot be renamed for free.
  //
  // Permanent, and not optional. The page is linked from the trip form and
  // the nav, it is in people's history and bookmarks (this was reported
  // from a phone with the old URL in the address bar), and a moved page
  // that 404s is worse than one with an awkward name. Next carries the
  // query string across on its own, so /spin?lang=bg still arrives in
  // Bulgarian.
  // Not `async`, despite the name: Next accepts a plain array returned
  // from this hook, and an async function with nothing to await is a lint
  // error here (require-await) as well as a small lie about the function.
  redirects() {
    return Promise.resolve([
      { source: "/spin", destination: "/decide-for-me", permanent: true },
    ]);
  },
};

export default nextConfig;
