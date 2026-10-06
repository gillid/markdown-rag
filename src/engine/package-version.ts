import { readFileSync } from "node:fs";
import { z } from "zod";

// Read, not imported: a JSON import from outside `src/` would break the pack-time emit planned in step 19.1, and `dist/engine/` will sit as deep as `src/engine/`.
const manifest = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ),
  );

export const ENGINE_VERSION = manifest.version;
