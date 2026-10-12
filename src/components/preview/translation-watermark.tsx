const pattern = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="180">
    <text x="8" y="110" fill="#1f5eff" fill-opacity="0.16" font-family="ui-monospace, monospace" font-size="15" font-weight="600" letter-spacing="1.8" transform="rotate(-30 230 90)">PREVIEW · CREDPRONTO · NOT FOR OFFICIAL USE</text>
  </svg>`,
);

/**
 * Layout-only overlay. Backend prints the real watermark into the
 * preview PDF on the server.
 */
export function TranslationWatermark() {
  return (
    <div
      aria-hidden
      data-testid="translation-watermark"
      className="pointer-events-none absolute inset-0 z-10"
      style={{
        backgroundImage: `url("data:image/svg+xml,${pattern}")`,
        backgroundRepeat: "repeat",
      }}
    />
  );
}
