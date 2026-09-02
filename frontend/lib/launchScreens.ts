// The devices we ship an iOS launch image for, shared by the generator
// (scripts/makeLaunchScreens.mjs, which renders the PNGs) and the root
// layout (which emits the <link> tags). One list, so a device can never
// have an image without a link or a link without an image.
//
// Background: an installed PWA on iOS does not use the manifest's
// background_color for its launch screen. With no apple-touch-startup-image
// declared, iOS paints plain white until the web view first draws — which
// is why opening the app flashed white before our own parchment splash.
//
// iOS matches a startup image only when the media query names the device's
// exact CSS dimensions and pixel ratio, so this has to be an explicit
// device list rather than one scalable asset. Portrait only: a phone is
// launched upright essentially always, and covering landscape would double
// the asset count for a case almost nobody hits.

export interface LaunchDevice {
  width: number;
  height: number;
  ratio: number;
  /** Which phones land on this size — for whoever reads the list next. */
  note: string;
}

export const LAUNCH_DEVICES: LaunchDevice[] = [
  { width: 440, height: 956, ratio: 3, note: "16 Pro Max" },
  { width: 430, height: 932, ratio: 3, note: "14/15 Pro Max, 15/16 Plus" },
  { width: 428, height: 926, ratio: 3, note: "12/13 Pro Max, 14 Plus" },
  { width: 414, height: 896, ratio: 3, note: "XS Max, 11 Pro Max" },
  { width: 414, height: 896, ratio: 2, note: "XR, 11" },
  { width: 414, height: 736, ratio: 3, note: "8 Plus" },
  { width: 402, height: 874, ratio: 3, note: "16 Pro" },
  { width: 393, height: 852, ratio: 3, note: "14 Pro, 15, 16" },
  { width: 390, height: 844, ratio: 3, note: "12, 13, 14" },
  { width: 375, height: 812, ratio: 3, note: "X, XS, 11 Pro" },
  { width: 375, height: 667, ratio: 2, note: "SE 2/3, 8" },
  { width: 360, height: 780, ratio: 3, note: "12/13 mini" },
];

export function launchImageHref(d: LaunchDevice): string {
  return `/launch/launch-${d.width}x${d.height}@${d.ratio}x.png`;
}

export function launchMediaQuery(d: LaunchDevice): string {
  return (
    `(device-width: ${d.width}px) and (device-height: ${d.height}px) and ` +
    `(-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: portrait)`
  );
}
