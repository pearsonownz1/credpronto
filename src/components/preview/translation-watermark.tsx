const pattern = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="160">
    <text x="8" y="88" fill="#121212" fill-opacity="0.16" font-family="Inter, sans-serif" font-size="15" font-weight="600" transform="rotate(-24 140 80)">PREVIEW, CredPronto</text>
  </svg>`,
);

/**
 * Layout-only overlay. Real preview protection is a server-rendered
 * watermarked PDF from Backend.
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
