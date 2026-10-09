import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chunkText,
  hashChunk,
  type SidecarChunk,
} from "../../src/sidecars/chunk.ts";
import {
  parseSidecar,
  type Sidecar,
  SidecarError,
  serializeSidecar,
} from "../../src/sidecars/sidecar.ts";
import {
  readSidecar,
  sidecarPath,
  writeSidecar,
} from "../../src/sidecars/store.ts";

const DOC_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HASH_1 =
  "7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78";
const HASH_2 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const BODY = "# Intro\n\nHello world.\n\n## Details\n\nSecond part.\n";

function makeSidecar(): Sidecar {
  return {
    docHash: DOC_HASH,
    chunker: "structural@1",
    model: "bge-small-en-v1.5-q8",
    dims: 4,
    chunks: [
      {
        start: 0,
        end: 23,
        breadcrumb: "Doc › Intro",
        anchor: "intro",
        hash: HASH_1,
        vector: new Float32Array([1, 0.5, -2, 0.25]),
      },
      {
        start: 23,
        end: BODY.length,
        breadcrumb: "Doc › Details",
        anchor: "details",
        hash: HASH_2,
        vector: new Float32Array([0, 1, 0, -1]),
      },
    ],
  };
}

const EXPECTED_JSON = `{
  "format": 1,
  "doc_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "chunker": "structural@1",
  "model": "bge-small-en-v1.5-q8",
  "dims": 4,
  "chunks": [
    {
      "start": 0,
      "end": 23,
      "breadcrumb": "Doc › Intro",
      "anchor": "intro",
      "hash": "7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78",
      "vector": "ADwAOADAADQ="
    },
    {
      "start": 23,
      "end": 48,
      "breadcrumb": "Doc › Details",
      "anchor": "details",
      "hash": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      "vector": "AAAAPAAAALw="
    }
  ]
}
`;

describe("serializeSidecar", () => {
  it("produces the exact expected bytes", () => {
    expect(serializeSidecar(makeSidecar())).toBe(EXPECTED_JSON);
  });

  it("is byte-identical for identical input", () => {
    expect(serializeSidecar(makeSidecar())).toBe(
      serializeSidecar(makeSidecar()),
    );
  });

  it.each([
    ["end before start", { start: 10, end: 5 }],
    ["negative offset", { start: -1 }],
    ["fractional offset", { end: 2.5 }],
    ["empty hash", { hash: "" }],
    ["NaN vector value", { vector: new Float32Array([1, Number.NaN, 0, 0]) }],
    [
      "vector value beyond float16 range",
      { vector: new Float32Array([70000, 0, 0, 0]) },
    ],
  ])("rejects a chunk with %s", (_name, override) => {
    const sidecar = makeSidecar();
    sidecar.chunks[0] = {
      ...(sidecar.chunks[0] as SidecarChunk),
      ...override,
    };

    expect(() => serializeSidecar(sidecar)).toThrow(SidecarError);
  });

  it("rejects overlapping chunks", () => {
    const sidecar = makeSidecar();
    sidecar.chunks[1] = { ...(sidecar.chunks[1] as SidecarChunk), start: 20 };

    expect(() => serializeSidecar(sidecar)).toThrow(
      /in order and must not overlap/,
    );
  });

  it("rejects out-of-order chunks", () => {
    const sidecar = makeSidecar();
    sidecar.chunks.reverse();

    expect(() => serializeSidecar(sidecar)).toThrow(
      /in order and must not overlap/,
    );
  });

  it("rejects non-positive dims", () => {
    const sidecar = makeSidecar();
    sidecar.dims = 0;
    sidecar.chunks = [];

    expect(() => serializeSidecar(sidecar)).toThrow(SidecarError);
  });

  it("rejects a vector that does not match dims", () => {
    const sidecar = makeSidecar();
    sidecar.dims = 3;

    expect(() => serializeSidecar(sidecar)).toThrow(SidecarError);
  });
});

describe("parseSidecar", () => {
  it("round-trips the literal fixture", () => {
    const parsed = parseSidecar(EXPECTED_JSON);

    expect(parsed.docHash).toBe(DOC_HASH);
    expect(parsed.chunker).toBe("structural@1");
    expect(parsed.chunks.map((chunk) => [...chunk.vector])).toEqual([
      [1, 0.5, -2, 0.25],
      [0, 1, 0, -1],
    ]);
    expect(serializeSidecar(parsed)).toBe(EXPECTED_JSON);
  });

  it("rejects an unknown format version with a regenerate hint", () => {
    const json = EXPECTED_JSON.replace('"format": 1', '"format": 2');

    expect(() => parseSidecar(json)).toThrow(/unsupported sidecar format/);
  });

  it.each([
    [
      "doc_hash",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ],
    [
      "hash",
      "7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78",
    ],
  ])("rejects a malformed %s", (key, digest) => {
    const json = EXPECTED_JSON.replace(
      `"${key}": "${digest}"`,
      `"${key}": "x"`,
    );

    expect(() => parseSidecar(json)).toThrow(/sha256 hex digest/);
  });

  it("rejects a chunk that ends before it starts", () => {
    const json = EXPECTED_JSON.replace('"start": 0,', '"start": 30,');

    expect(() => parseSidecar(json)).toThrow(/end must be after start/);
  });

  it("rejects an empty chunk", () => {
    const json = EXPECTED_JSON.replace('"end": 23,', '"end": 0,');

    expect(() => parseSidecar(json)).toThrow(/end must be after start/);
  });

  it("rejects overlapping chunks", () => {
    const json = EXPECTED_JSON.replace('"start": 23,', '"start": 20,');

    expect(() => parseSidecar(json)).toThrow(/in order and must not overlap/);
  });

  it("rejects a vector holding Infinity", () => {
    const json = EXPECTED_JSON.replace("ADwAOADAADQ=", "AHwAAAAAAAA=");

    expect(() => parseSidecar(json)).toThrow(/non-finite/);
  });

  it("rejects a negative offset", () => {
    const json = EXPECTED_JSON.replace('"start": 0,', '"start": -1,');

    expect(() => parseSidecar(json)).toThrow(SidecarError);
  });

  it("rejects unknown keys", () => {
    const json = EXPECTED_JSON.replace(
      '"dims": 4,',
      '"dims": 4,\n  "extra": 1,',
    );

    expect(() => parseSidecar(json)).toThrow(SidecarError);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseSidecar("{")).toThrow(/invalid JSON/);
  });

  it("rejects a vector of the wrong byte length", () => {
    const json = EXPECTED_JSON.replace("ADwAOADAADQ=", "ADwA");

    expect(() => parseSidecar(json)).toThrow(/chunk at 0/);
  });
});

describe("chunk offsets", () => {
  it("resolve back to the expected text", () => {
    const [first, second] = makeSidecar().chunks;

    expect(chunkText(BODY, first as SidecarChunk)).toBe(
      "# Intro\n\nHello world.\n\n",
    );
    expect(chunkText(BODY, second as SidecarChunk)).toBe(
      "## Details\n\nSecond part.\n",
    );
  });

  it("hashes breadcrumb and text joined by a newline", () => {
    expect(hashChunk("a", "b")).toBe(
      "7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78",
    );
  });
});

describe("sidecar store", () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(join(tmpdir(), "markdown-rag-sidecar-"));
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it("places sidecars under vectors/ mirroring the document path", () => {
    expect(sidecarPath("/t", "runbooks/db.md")).toBe(
      resolve("/t", "vectors", "runbooks", "db.md.vec.json"),
    );
  });

  it("writes then reads a sidecar", async () => {
    await writeSidecar(targetDir, "runbooks/db.md", makeSidecar());

    const written = await readFile(
      sidecarPath(targetDir, "runbooks/db.md"),
      "utf8",
    );
    expect(written).toBe(EXPECTED_JSON);
    expect(await readSidecar(targetDir, "runbooks/db.md")).toEqual(
      makeSidecar(),
    );
  });

  it("accepts a document whose name merely starts with two dots", async () => {
    await writeSidecar(targetDir, "..notes.md", makeSidecar());

    expect(await readSidecar(targetDir, "..notes.md")).toEqual(makeSidecar());
  });

  it("wraps filesystem read errors with the sidecar path", async () => {
    await mkdir(sidecarPath(targetDir, "dir.md"), { recursive: true });

    await expect(readSidecar(targetDir, "dir.md")).rejects.toThrow(
      /dir\.md\.vec\.json/,
    );
  });

  it.each([
    "../../evil.md",
    "a/../b.md",
    "./b.md",
    "a//b.md",
    "/abs.md",
    "C:/abs.md",
    "a\\b.md",
  ])("refuses the document path %j", async (docPath) => {
    await expect(
      writeSidecar(targetDir, docPath, makeSidecar()),
    ).rejects.toThrow(/normalised POSIX path/);
  });

  it("keeps the underlying error as the cause of a read failure", async () => {
    await mkdir(sidecarPath(targetDir, "dir.md"), { recursive: true });

    const error = await readSidecar(targetDir, "dir.md").catch((e) => e);

    expect((error.cause as NodeJS.ErrnoException).code).toBe("EISDIR");
  });

  it("names the file when a sidecar is corrupt", async () => {
    await writeSidecar(targetDir, "a.md", makeSidecar());
    await writeFile(sidecarPath(targetDir, "a.md"), "{", "utf8");

    await expect(readSidecar(targetDir, "a.md")).rejects.toThrow(
      /a\.md\.vec\.json.*invalid JSON/,
    );
  });

  it("replaces an existing sidecar", async () => {
    await writeSidecar(targetDir, "a.md", makeSidecar());
    const updated = makeSidecar();
    updated.chunker = "structural@2";

    await writeSidecar(targetDir, "a.md", updated);

    expect((await readSidecar(targetDir, "a.md"))?.chunker).toBe(
      "structural@2",
    );
    expect(await readdir(join(targetDir, "vectors"))).toEqual([
      "a.md.vec.json",
    ]);
  });

  it("removes the temp file when the final rename fails", async () => {
    const path = sidecarPath(targetDir, "a.md");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "occupied"), "x", "utf8");

    await expect(
      writeSidecar(targetDir, "a.md", makeSidecar()),
    ).rejects.toThrow();

    expect(await readdir(join(targetDir, "vectors"))).toEqual([
      "a.md.vec.json",
    ]);
  });

  it("leaves no temp files after writing", async () => {
    await writeSidecar(targetDir, "a.md", makeSidecar());

    expect(await readdir(join(targetDir, "vectors"))).toEqual([
      "a.md.vec.json",
    ]);
  });

  it("returns undefined when there is no sidecar", async () => {
    expect(await readSidecar(targetDir, "missing.md")).toBeUndefined();
  });
});
