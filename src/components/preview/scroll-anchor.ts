export type ScrollAnchor = {
  pageNumber: number;
  x: number;
  y: number;
};

type Visibility = {
  pageNumber: number;
  original: {
    pageX: number;
    pageY: number;
  };
};

export function visibleAnchor(metrics: {
  currentPage: number;
  pageVisibilityMetrics: Visibility[];
}): ScrollAnchor {
  const hit =
    metrics.pageVisibilityMetrics.find(
      (entry) => entry.pageNumber === metrics.currentPage,
    ) ?? metrics.pageVisibilityMetrics[0];

  if (!hit) {
    return { pageNumber: Math.max(metrics.currentPage, 1), x: 0, y: 0 };
  }

  return {
    pageNumber: hit.pageNumber,
    x: hit.original.pageX,
    y: hit.original.pageY,
  };
}

export function anchorsMatch(
  left: ScrollAnchor,
  right: ScrollAnchor,
  tolerance = 2,
) {
  return (
    left.pageNumber === right.pageNumber &&
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance
  );
}
