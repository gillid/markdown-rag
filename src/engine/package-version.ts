import { readFileSync } from "node:fs";
import { z } from "zod";

// Read, not imported: a JSON import from outside `src/` would break the pack-time emit, and `dist/engine/` sits as deep as `src/engine/`, so `../../package.json` resolves in both.
const manifest = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ),
  );

export const ENGINE_VERSION = manifest.version;
