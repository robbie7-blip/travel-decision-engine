// The authored scenes of the promo - the parts that are not a recording
// of a page.
//
// WHY THESE EXIST. Filming the product gives you the product, and a reel
// made only of that reads as documentation however well it is framed: a
// page, a scroll, a cut, repeat. The scenes here are the other half -
// title work, the confidence legend assembling itself, the four voices
// arriving - and they are what turn a screen recording into something
// worth posting.
//
// WHAT THEY ARE MADE OF. Nothing invented. The type is Literata and the
// UI face, loaded from the app's own built stylesheet. The colours are
// the app's own custom properties, including the five confidence tiers
// read from their real rules. The mark is public/logo-icon.svg. The
// portraits are the same path data components/voiceAvatarArt.ts ships.
// The words are the product's own, out of lib/i18n.ts. A promo for a
// product whose argument is that it does not pretend should not open on
// a claim the product does not make.
//
// HOW THEY ANIMATE. Every scene defines window.__seek(t), t running 0 to
// 1, and positions everything itself from that one number. No CSS
// animations and no timers: the recorder sets t, takes the frame, sets
// the next t. That makes the motion exactly as smooth as the frame rate
// and completely reproducible, and it sidesteps the whole business of
// pausing the page's clock - which is what made the recorder's captures
// stall for minutes at a time. A seek-driven page is never waiting for
// anything.

/** Eases. `out` for things arriving, `inOut` for things travelling. */
const EASE = `
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const outBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const inOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
/** A sub-animation: 0 before \`from\`, 1 after \`to\`, eased between. */
const span = (t, from, to, ease = outCubic) => ease(clamp01((t - from) / (to - from)));
`;

/** Shared frame: a full-bleed parchment stage with generous margins. */
const STAGE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:720px;overflow:hidden;background:var(--bg-page,#f7f1e2)}
body{display:flex;align-items:center;justify-content:center}
.stage{position:relative;width:1280px;height:720px;padding:0 104px;display:flex;
  flex-direction:column;justify-content:center;overflow:hidden}
.line{display:block;overflow:hidden}
.line > span{display:block;will-change:transform,opacity}
.rule{height:5px;background:var(--brand-teal,#2c6a4c);border-radius:3px;transform-origin:left center}
`;

/**
 * The opening title.
 *
 * The headline is the product's own and arrives a line at a time from
 * under its own mask, so the words appear to be set rather than to fly
 * in. The mark draws its two strokes and drops its dot - the same three
 * pieces the real logo is built from - and the rule wipes last, which is
 * the beat the cut leaves on.
 */
export function openingScene({ mark }) {
  return {
    name: "open",
    seconds: 5.2,
    html: `
      <style>
        ${STAGE_CSS}
        .mark{width:132px;height:132px;margin-bottom:38px}
        .mark svg{width:100%;height:100%;display:block}
        h1{font-size:106px;line-height:1.06;letter-spacing:-0.02em;color:var(--ink,#1b1a17);
          font-weight:600;font-style:italic}
        .sub{margin-top:34px;font-size:30px;line-height:1.5;color:var(--ink-soft,#45423c);max-width:900px}
        .rule{margin-top:46px;width:210px}
      </style>
      <div class="stage">
        <div class="mark" id="mark">${mark}</div>
        <h1 class="font-display">
          <span class="line"><span id="l1">It doesn&rsquo;t list options.</span></span>
          <span class="line"><span id="l2">It decides.</span></span>
        </h1>
        <div class="sub" id="sub">One itinerary, costed and checked, for where you are actually going.</div>
        <div class="rule" id="rule"></div>
      </div>
      <script>
        ${EASE}
        const mark = document.getElementById("mark");
        const strokes = [...mark.querySelectorAll("path,line,polyline")];
        const dots = [...mark.querySelectorAll("circle")];
        for (const s of strokes) {
          const len = s.getTotalLength ? s.getTotalLength() : 100;
          s.style.strokeDasharray = len;
          s.dataset.len = len;
        }
        window.__seek = (t) => {
          // The mark draws, then the dot falls into place.
          const draw = span(t, 0, 0.3);
          for (const s of strokes) s.style.strokeDashoffset = Number(s.dataset.len) * (1 - draw);
          // The dot and its glow fall in together, after the strokes.
          const d = span(t, 0.22, 0.42, outBack);
          for (const c of dots) {
            c.style.opacity = clamp01(d * 1.6);
            c.style.transform = "translateY(" + (-26 * (1 - d)) + "px)";
          }
          // Each line rises out of its own mask.
          const l1 = span(t, 0.26, 0.56);
          const l2 = span(t, 0.36, 0.66);
          document.getElementById("l1").style.transform = "translateY(" + (112 * (1 - l1)) + "%)";
          document.getElementById("l2").style.transform = "translateY(" + (112 * (1 - l2)) + "%)";
          const s = span(t, 0.58, 0.84);
          const sub = document.getElementById("sub");
          sub.style.opacity = s;
          sub.style.transform = "translateY(" + (18 * (1 - s)) + "px)";
          document.getElementById("rule").style.transform = "scaleX(" + span(t, 0.72, 0.96) + ")";
        };
        window.__seek(0);
      </script>`,
  };
}

/**
 * The confidence legend, assembling.
 *
 * This is the product's actual argument and the hardest thing to show by
 * filming, because on the page it is five small labels in a row. Here
 * each tier draws its own rule in its own colour and names itself, which
 * is the same information at the size it deserves.
 *
 * The five colours are read off the page at render time rather than
 * copied, so they cannot drift from the ones a traveller sees.
 */
export function confidenceScene() {
  // The same five colours components/ui.tsx assigns, by the same token
  // names, so a change to the palette moves this scene with it. Read from
  // there rather than probed off a rendered element: the only place those
  // rules are drawn on the page is inside .hero, where they are tuned for
  // a dark green band and would be wrong on parchment.
  const tiers = [
    ["2 sources agree", "var(--grounded)"],
    ["grounded in a fact", "var(--grounded)"],
    ["single source", "var(--tier-single-source)"],
    ["sources disagree", "var(--unverified)"],
    ["unverified guess", "var(--tier-inferred)"],
  ];
  return {
    name: "confidence",
    seconds: 5.0,
    html: `
      <style>
        ${STAGE_CSS}
        h2{font-size:72px;line-height:1.12;letter-spacing:-0.015em;color:var(--ink,#1b1a17);
          font-weight:600;font-style:italic;max-width:980px}
        .tiers{margin-top:58px;display:flex;flex-direction:column;gap:27px}
        .tier{display:flex;align-items:center;gap:22px;will-change:transform,opacity}
        .tier i{display:block;width:104px;height:9px;border-radius:5px;transform-origin:left center}
        .tier span{font-size:31px;color:var(--ink-soft,#45423c);letter-spacing:0.01em}
      </style>
      <div class="stage">
        <h2 class="font-display">Every line carries its own confidence.</h2>
        <div class="tiers">
          ${tiers
            .map(
              ([label, colour], i) =>
                `<div class="tier" data-i="${i}"><i style="background:${colour}"></i><span class="font-ui">${label}</span></div>`
            )
            .join("")}
        </div>
      </div>
      <script>
        ${EASE}
        const head = document.querySelector("h2");
        const rows = [...document.querySelectorAll(".tier")];
        window.__seek = (t) => {
          const h = span(t, 0, 0.26);
          head.style.opacity = h;
          head.style.transform = "translateY(" + (26 * (1 - h)) + "px)";
          rows.forEach((row, i) => {
            const a = span(t, 0.22 + i * 0.1, 0.52 + i * 0.1);
            row.style.opacity = a;
            row.style.transform = "translateX(" + (-34 * (1 - a)) + "px)";
            row.querySelector("i").style.transform = "scaleX(" + span(t, 0.26 + i * 0.1, 0.62 + i * 0.1) + ")";
          });
        };
        window.__seek(0);
      </script>`,
  };
}

/**
 * The four voices.
 *
 * The portraits are the ones the product ships - the same path data,
 * drawn at a size where the linework can actually be seen, which at 26
 * and 34 pixels in a chat thread it cannot. They arrive on a slight
 * overshoot, one after another, and their names set underneath.
 */
export function voicesScene({ avatars, accents }) {
  const voices = [
    ["neighbour", "The neighbour", "Lives here"],
    ["cook", "The cook", "Markets, seasons"],
    ["night", "The night owl", "After dark"],
    ["family", "The parent", "With kids"],
  ];
  return {
    name: "voices",
    seconds: 4.4,
    html: `
      <style>
        ${STAGE_CSS}
        h2{font-size:68px;line-height:1.12;letter-spacing:-0.015em;color:var(--ink,#1b1a17);
          font-weight:600;font-style:italic}
        .row{margin-top:66px;display:flex;gap:46px}
        .v{display:flex;flex-direction:column;align-items:center;gap:18px;width:240px;
          will-change:transform,opacity}
        .disc{width:200px;height:200px;border-radius:50%;display:flex;align-items:center;justify-content:center}
        .disc svg{width:180px;height:180px;display:block}
        .v b{font-size:27px;color:var(--ink,#1b1a17);font-weight:600}
        .v em{font-size:21px;font-style:normal;color:var(--ink-dim,#6b665d)}
      </style>
      <div class="stage">
        <h2 class="font-display">Ask someone who lives there.</h2>
        <div class="row">
          ${voices
            .map(
              ([key, name, note], i) => `
            <div class="v" data-i="${i}">
              <div class="disc" style="background:${accents[key]}29">
                <svg viewBox="0 0 256 256" aria-hidden="true">
                  <circle cx="128" cy="128" r="110" fill="${accents[key]}" opacity="0.16"></circle>
                  <path fill="${accents[key]}" fill-rule="evenodd" d="${avatars[key]}"></path>
                </svg>
              </div>
              <b class="font-display">${name}</b><em class="font-ui">${note}</em>
            </div>`
            )
            .join("")}
        </div>
      </div>
      <script>
        ${EASE}
        const head = document.querySelector("h2");
        const cards = [...document.querySelectorAll(".v")];
        window.__seek = (t) => {
          const h = span(t, 0, 0.24);
          head.style.opacity = h;
          head.style.transform = "translateY(" + (24 * (1 - h)) + "px)";
          cards.forEach((card, i) => {
            const a = span(t, 0.18 + i * 0.12, 0.54 + i * 0.12, outBack);
            card.style.opacity = clamp01(a * 1.4);
            card.style.transform = "translateY(" + (40 * (1 - a)) + "px) scale(" + (0.86 + 0.14 * a) + ")";
          });
        };
        window.__seek(0);
      </script>`,
  };
}

/** The end card: the mark, the name, and where to find it. */
export function endScene({ mark }) {
  return {
    name: "end",
    seconds: 3.4,
    html: `
      <style>
        ${STAGE_CSS}
        .stage{align-items:center;text-align:center;padding:0 140px}
        .mark{width:152px;height:152px;margin-bottom:28px}
        .mark svg{width:100%;height:100%;display:block}
        .word{font-size:112px;line-height:1;color:var(--brand-teal,#2c6a4c);font-weight:600}
        .tag{margin-top:22px;font-size:26px;letter-spacing:0.16em;text-transform:uppercase;
          color:var(--ink-dim,#6b665d)}
        .dom{margin-top:52px;font-size:38px;color:var(--ink,#1b1a17)}
      </style>
      <div class="stage">
        <div class="mark" id="mark">${mark}</div>
        <div class="word font-display" id="word">decide</div>
        <div class="tag font-ui" id="tag">Your travel, decided.</div>
        <div class="dom font-ui" id="dom">yourdecide.com</div>
      </div>
      <script>
        ${EASE}
        const mark = document.getElementById("mark");
        const dots = [...mark.querySelectorAll("circle")];
        window.__seek = (t) => {
          const m = span(t, 0, 0.3);
          mark.style.opacity = m;
          mark.style.transform = "scale(" + (0.9 + 0.1 * m) + ")";
          const d = span(t, 0.16, 0.44, outBack);
          for (const c of dots) c.style.transform = "translateY(" + (-22 * (1 - d)) + "px)";
          for (const [id, from, to] of [["word", 0.2, 0.5], ["tag", 0.34, 0.64], ["dom", 0.52, 0.84]]) {
            const a = span(t, from, to);
            const el = document.getElementById(id);
            el.style.opacity = a;
            el.style.transform = "translateY(" + (16 * (1 - a)) + "px)";
          }
        };
        window.__seek(0);
      </script>`,
  };
}
