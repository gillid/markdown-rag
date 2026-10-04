import type { DocumentLoadError } from "../contract/loader.ts";

export function formatPathErrors(errors: readonly DocumentLoadError[]): string {
  return errors
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((error) => `${error.path}: ${error.reason}`)
    .join("\n");
}
