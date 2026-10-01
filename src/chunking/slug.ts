const FALLBACK_SLUG = "section";

/** GitHub-style heading slug: duplicates get `-1`, `-2`, … so anchors within a document are unique. */
export function createSlugger(): (text: string) => string {
  const used = new Set<string>();
  const counts = new Map<string, number>();
  return (text) => {
    const base =
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
        .replace(/ /g, "-") || FALLBACK_SLUG;
    let slug = base;
    let count = counts.get(base) ?? 0;
    while (used.has(slug)) {
      count += 1;
      slug = `${base}-${count}`;
    }
    counts.set(base, count);
    used.add(slug);
    return slug;
  };
}
