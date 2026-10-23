/** Server clock for Clio reads. Page components must not call Date.now during render. */
export function clioNow(): number {
  return Date.now();
}
