// TEMPORARY - reverted in the next commit.
//
// Fails at BUILD time, not at type-check time, which is the whole point:
// the failure being investigated passed tsc and every suite and then
// broke inside `next build`. A type error would be caught two steps
// earlier and would prove nothing about the new annotation.
//
// NOT under a folder starting with an underscore: Next treats those as
// private and leaves them out of the build entirely, which is how the
// first two attempts at this quietly built clean.
throw new Error("build canary: proving the build-failure annotation is readable");

export default function BuildCanary() {
  return null;
}
