import { InvalidRequestError, parseRequest } from "../engine/errors.ts";
import { type ListRequest, listRequestSchema } from "../engine/schemas/list.ts";
import { type Filter, filterSchema } from "../index/filter.ts";
import { PLAIN_NUMBER } from "../plain-number.ts";

export const FILTER_PARAMS = [
  "source",
  "tag",
  "tag_any",
  "dir",
  "updated_after",
];

export const LIST_PARAMS = [...FILTER_PARAMS, "sort", "limit", "offset"];

function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw new InvalidRequestError(`Query parameter "${name}" was given twice`);
  }
  return values[0];
}

function number(name: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = PLAIN_NUMBER.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new InvalidRequestError(
      `Query parameter "${name}" must be a finite number, got "${text}"`,
    );
  }
  return value;
}

/** A typo in a parameter name would otherwise read as "no constraint", so unknown names are errors. */
export function rejectUnknownParams(
  params: URLSearchParams,
  allowed: readonly string[],
): void {
  for (const name of new Set(params.keys())) {
    if (!allowed.includes(name)) {
      throw new InvalidRequestError(
        `Unknown query parameter "${name}"; expected ${allowed.length === 0 ? "none" : allowed.join(", ")}`,
      );
    }
  }
}

function listParam(
  params: URLSearchParams,
  name: string,
): string[] | undefined {
  const values = params.getAll(name);
  return values.length === 0 ? undefined : values;
}

/** The one place query parameters become filter fields, for `/overview` and `/documents`. List fields repeat: `?tag=a&tag=b`. The schema validates them. */
function filterFields(params: URLSearchParams) {
  return {
    sources: listParam(params, "source"),
    tags: listParam(params, "tag"),
    tags_any: listParam(params, "tag_any"),
    dir: single(params, "dir"),
    updated_after: number("updated_after", single(params, "updated_after")),
  };
}

export function filterFromParams(params: URLSearchParams): Filter {
  return parseRequest(filterSchema, filterFields(params), "filter");
}

export function listRequestFromParams(params: URLSearchParams): ListRequest {
  return parseRequest(
    listRequestSchema,
    {
      filter: filterFields(params),
      sort: single(params, "sort"),
      limit: number("limit", single(params, "limit")),
      offset: number("offset", single(params, "offset")),
    },
    "list",
  );
}

export function bodyFlagFromParams(params: URLSearchParams): boolean {
  const text = single(params, "body");
  if (text === undefined || text === "true") return true;
  if (text === "false") return false;
  throw new InvalidRequestError(
    `Query parameter "body" must be true or false, got "${text}"`,
  );
}
