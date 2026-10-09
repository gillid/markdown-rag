import { execFileSync, spawnSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const prebuiltTarball = process.argv[2];
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
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
  } catch (error) {
    // tsc reports its diagnostics on stdout, which the thrown message omits.
    const stdout =
      error instanceof Error && "stdout" in error ? String(error.stdout) : "";
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${stdout}`,
    );
  }
}

function runBin(bin: string, args: string[]) {
  return spawnSync(bin, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function fail(message: string): never {
  throw new Error(message);
}

const work = await mkdtemp(join(tmpdir(), "markdown-rag-pack-"));
try {
  let tarballPath: string;
  if (prebuiltTarball === undefined) {
    const packDir = join(work, "pack");
    await mkdir(packDir);
    run("pnpm", ["pack", "--pack-destination", packDir], repoRoot);
    const [tarball] = (await readdir(packDir)).filter((f) =>
      f.endsWith(".tgz"),
    );
    if (tarball === undefined) fail("pnpm pack produced no tarball");
    tarballPath = join(packDir, tarball);
  } else {
    tarballPath = resolve(prebuiltTarball);
  }

  const consumerDir = join(work, "consumer");
  await mkdir(consumerDir);
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  run(
    "npm",
    ["install", tarballPath, "typescript@^7.0.2", "@types/node@24"],
    consumerDir,
  );

  const bin = join(consumerDir, "node_modules", ".bin", `markdown-rag${exe}`);

  const help = runBin(bin, ["--help"]);
  if (help.status !== 0 || !help.stdout.includes("Usage: markdown-rag")) {
    fail(`markdown-rag --help failed:\n${help.stdout}${help.stderr}`);
  }

  const guide = join(
    consumerDir,
    "node_modules",
    "markdown-rag",
    "docs",
    "agent-guide.md",
  );
  await access(guide).catch(() => fail(`the package ships no ${guide}`));

  const knowledgeBase = join(work, "docs");
  await cp(join(repoRoot, "examples", "docs"), knowledgeBase, {
    recursive: true,
    filter: (source) => basename(source) !== ".markdown-rag",
  });
  const check = runBin(bin, ["check", "--source-dir", knowledgeBase]);
  const checkOutput = check.stdout + check.stderr;
  if (
    check.status === 0 ||
    !checkOutput.includes("Run markdown-rag embed first") ||
    checkOutput.includes("failed the contract")
  ) {
    fail(
      `markdown-rag check did not stop at the missing sidecars:\n${checkOutput}`,
    );
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
} catch (error) {
  console.error(
    `pack-smoke: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
