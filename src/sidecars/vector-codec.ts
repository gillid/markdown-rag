const BYTES_PER_VALUE = 2;
const LITTLE_ENDIAN = true;

/** Length of the canonical base64 text of a vector of `dims` values. */
export function encodedVectorLength(dims: number): number {
  return Math.ceil((dims * BYTES_PER_VALUE) / 3) * 4;
}

export function encodeVector(vector: Float32Array, dims: number): string {
  if (vector.length !== dims) {
    throw new Error(`vector has ${vector.length} dims, expected ${dims}`);
  }
  const view = new DataView(new ArrayBuffer(dims * BYTES_PER_VALUE));
  for (const [i, value] of vector.entries()) {
    const offset = i * BYTES_PER_VALUE;
    view.setFloat16(offset, value, LITTLE_ENDIAN);
    // A value past the float16 range rounds to Infinity, which would poison cosine scores.
    if (!Number.isFinite(view.getFloat16(offset, LITTLE_ENDIAN))) {
      throw new Error(`value ${value} does not fit in float16`);
    }
  }
  return Buffer.from(view.buffer).toString("base64");
}

export function decodeVector(encoded: string, dims: number): Float32Array {
  const bytes = Buffer.from(encoded, "base64");
  // Buffer's decoder is lenient; requiring a round trip keeps files byte-stable.
  if (bytes.toString("base64") !== encoded) {
    throw new Error("vector is not canonical base64");
  }
  if (bytes.length !== dims * BYTES_PER_VALUE) {
    throw new Error(
      `vector has ${bytes.length} bytes, expected ${dims * BYTES_PER_VALUE} for ${dims} dims`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const vector = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    const value = view.getFloat16(i * BYTES_PER_VALUE, LITTLE_ENDIAN);
    if (!Number.isFinite(value)) {
      throw new Error("vector holds a non-finite value");
    }
    vector[i] = value;
  }
  return vector;
}
