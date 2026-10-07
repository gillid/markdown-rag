export function usageError(message: string, help: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${message}

${help}`,
  };
}

export function toJson(output: unknown): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
