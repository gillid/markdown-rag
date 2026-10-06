/** An option value (a configured default or a request's) is out of range, or names a signal no document declares. */
export class RetrievalOptionError extends RangeError {
  override readonly name = "RetrievalOptionError";
}
