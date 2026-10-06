import { z } from "zod";

const DATE = String.raw`(\d{4})-(\d{2})-(\d{2})`;
const HOUR = String.raw`(?:[01]\d|2[0-3])`;
const MINUTE = String.raw`[0-5]\d`;
const TIME = String.raw`[T ]${HOUR}:${MINUTE}(?::${MINUTE}(?:\.\d+)?)?(?:Z|[+-]${HOUR}:${MINUTE})`;
const ISO_DATE_OR_DATETIME = new RegExp(`^${DATE}(?:${TIME})?$`);

/** An ISO 8601 calendar date (UTC midnight) or a date-time with an explicit zone, so the instant never depends on the host's timezone (ADR-003). */
export const updatedAtSchema = z
  .string({ error: "must be an ISO 8601 date or date-time string" })
  .transform((value, ctx) => {
    const match = ISO_DATE_OR_DATETIME.exec(value);
    if (!match) {
      ctx.addIssue({
        code: "custom",
        message: `"${value}" is not an ISO 8601 date (2024-01-05) or date-time with a zone (2024-01-05T10:00:00Z)`,
      });
      return z.NEVER;
    }
    const [, year, month, day] = match.map(Number);
    // `Date.UTC` would read years 0 to 99 as 1900 to 1999.
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);
    const timestamp = Date.parse(value.replace(" ", "T"));
    if (
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day ||
      Number.isNaN(timestamp)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `"${value}" is not a real date`,
      });
      return z.NEVER;
    }
    return timestamp;
  });
