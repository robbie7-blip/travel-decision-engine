// Side-effect-only import, must be the first import in index.ts. Sets
// FACTS_DIR before ./engine/prompt.ts (which reads it at module-load time)
// gets imported, so it finds worker/facts/ (a local copy — see the comment
// in index.ts on why this isn't a cross-directory import into frontend/)
// regardless of the worker's own working directory.
import path from "node:path";

process.env.FACTS_DIR ??= path.join(__dirname, "..", "facts");
