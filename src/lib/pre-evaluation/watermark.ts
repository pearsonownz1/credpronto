/** Tiled PREVIEW mark: brand blue at 9% opacity, rotated -30 degrees. */
export function previewWatermarkSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="180"><text x="24" y="110" fill="#1f5eff" fill-opacity="0.09" font-family="Inter, ui-sans-serif, sans-serif" font-size="28" font-weight="700" letter-spacing="2" transform="rotate(-30 140 90)">PREVIEW</text></svg>`;
}

export function previewWatermarkDataUrl(): string {
  return `url("data:image/svg+xml,${encodeURIComponent(previewWatermarkSvg())}")`;
}
