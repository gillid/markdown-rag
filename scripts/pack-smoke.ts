import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const exe = process.platform === "win32" ? ".cmd" : "";

const CONSUMER = `import { createEngine, type Engine } from "markdown-rag";

export function start(): Promise<Engine> {
  return createEngine({ sourceDir: "docs" });
}
`;

const CONSUMER_TSCONFIG = {
  compilerOptions: {
    module: "NodeNext",
    moduleResolution: "NodeNext",
    target: "ES2023",
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: ["node"],
  },
  include: ["consumer.ts"],
};

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function runBin(bin: string, args: string[]) {
  return spawnSync(bin, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function fail(message: string): never {
  console.error(`pack-smoke: ${message}`);
  process.exit(1);
}

const work = await mkdtemp(join(tmpdir(), "md-rag-pack-"));
try {
  const packDir = join(work, "pack");
  await mkdir(packDir);
  run("pnpm", ["pack", "--pack-destination", packDir], repoRoot);
  const [tarball] = (await readdir(packDir)).filter((f) => f.endsWith(".tgz"));
  if (tarball === undefined) fail("pnpm pack produced no tarball");

  const consumerDir = join(work, "consumer");
  await mkdir(consumerDir);
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  run(
    "npm",
    ["install", join(packDir, tarball), "typescript", "@types/node@24"],
    consumerDir,
  );

  const bin = join(consumerDir, "node_modules", ".bin", `md-rag${exe}`);

  const help = runBin(bin, ["--help"]);
  if (help.status !== 0 || !help.stdout.includes("Usage: md-rag")) {
    fail(`md-rag --help failed:\n${help.stdout}${help.stderr}`);
  }

  const knowledgeBase = join(work, "docs");
  await cp(join(repoRoot, "examples", "docs"), knowledgeBase, {
    recursive: true,
    filter: (source) => !source.includes(".md-rag"),
  });
  const check = runBin(bin, ["check", "--source-dir", knowledgeBase]);
  const checkOutput = check.stdout + check.stderr;
  if (check.status === 0 || !checkOutput.includes("Run md-rag embed first")) {
    fail(`md-rag check did not stop at the missing sidecars:\n${checkOutput}`);
  }

  await writeFile(join(consumerDir, "consumer.ts"), CONSUMER);
  await writeFile(
    join(consumerDir, "tsconfig.json"),
    JSON.stringify(CONSUMER_TSCONFIG),
  );
  run(
    join(consumerDir, "node_modules", ".bin", `tsc${exe}`),
    ["-p", "."],
    consumerDir,
  );

  console.log("pack-smoke: ok");
} finally {
  await rm(work, { recursive: true, force: true });
}
