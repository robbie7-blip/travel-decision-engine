// Side-effect-only import, must be the first import in index.ts. Sets
// FACTS_DIR before lib/engine/prompt.ts (which reads it at module-load
// time) gets imported, so the shared engine code finds the project's real
// facts/ directory regardless of the worker's own working directory.
import path from "node:path";

process.env.FACTS_DIR ??= path.join(__dirname, "..", "..", "facts");
