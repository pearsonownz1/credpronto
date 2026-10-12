/**
 * Resource Timing reports 0 for both sizes on cross-origin responses that omit
 * Timing-Allow-Origin, including signed PDF URLs, even when the body was read.
 */
export function timedDownloadLabel(entry: {
  decodedBodySize: number;
  transferSize: number;
}): string {
  if (entry.decodedBodySize > 0) return `${entry.decodedBodySize}b`;
  if (entry.transferSize > 0) return `${entry.transferSize}b`;
  return "unmeasured";
}
