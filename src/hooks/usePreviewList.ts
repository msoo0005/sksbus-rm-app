import { useMemo, useState } from "react";

// Long lists show a handful of rows with a "Show all N" affordance, so a screen
// with several sections doesn't push everything below it off the page. Four
// screens had grown their own copy of this; searching bypasses the cap, since
// typing a query is itself a narrowing action.

export function usePreviewList<T>(rows: T[], previewCount: number, query?: string) {
  const [expanded, setExpanded] = useState(false);
  const searching = !!query?.trim();

  const visible = useMemo(
    () => (expanded || searching ? rows : rows.slice(0, previewCount)),
    [rows, expanded, searching, previewCount],
  );

  return {
    visible,
    hasMore: rows.length > visible.length,
    total: rows.length,
    expand: () => setExpanded(true),
  };
}
