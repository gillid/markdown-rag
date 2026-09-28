export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
