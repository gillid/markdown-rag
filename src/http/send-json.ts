import type { ServerResponse } from "node:http";

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  // Serialised first: if it throws, no header has been sent and the caller can still answer 500.
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(text);
}
