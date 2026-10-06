// Kept free of imports so that config loading doesn't pull in the search index.
export const SEARCH_MODES = ["hybrid", "keyword", "semantic"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
