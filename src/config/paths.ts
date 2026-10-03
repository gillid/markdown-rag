import { isAbsolute, relative, sep } from "node:path";

export function isSameOrAncestor(dir: string, of: string): boolean {
  const path = relative(dir, of);
  return path === "" || (!isAbsolute(path) && path.split(sep)[0] !== "..");
}

// Via relative(), which compares case-insensitively on Windows where `!==` would not.
export function isStrictlyInside(path: string, dir: string): boolean {
  return relative(dir, path) !== "" && isSameOrAncestor(dir, path);
}
