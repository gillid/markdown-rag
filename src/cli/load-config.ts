import {
  type Config,
  ConfigError,
  type ConfigInput,
  loadConfig,
} from "../config/config.ts";
import type { CliResult } from "./result.ts";

export type ConfigOutcome =
  | { ok: true; config: Config }
  | { ok: false; result: CliResult };

export function loadConfigOutcome(input: ConfigInput): ConfigOutcome {
  try {
    return { ok: true, config: loadConfig(input) };
  } catch (cause) {
    if (cause instanceof ConfigError) {
      return {
        ok: false,
        result: { exitCode: 1, stdout: "", stderr: `${cause.message}\n` },
      };
    }
    throw cause;
  }
}
