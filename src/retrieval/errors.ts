/** An option value (a configured default or a request's) is out of range, or names a signal other than recency or a tag some document carries. */
export class RetrievalOptionError extends RangeError {
  override readonly name = "RetrievalOptionError";
}
