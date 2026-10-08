/** An option value (a configured default or a request's) is out of range, or names a signal other than recency. */
export class RetrievalOptionError extends RangeError {
  override readonly name = "RetrievalOptionError";
}
