/**
 * MedVoice AI mark, drawn rather than loaded.
 *
 * Inline SVG so it stays sharp on a tablet at any density, needs no network
 * request on a clinic connection, and can take its colour from the surrounding
 * theme. Swap in the supplied raster file if you would rather ship that.
 */
export function Logo({
  height = 30,
  showWordmark = true,
  onBrand = false,
}: {
  height?: number;
  showWordmark?: boolean;
  /** On the brand-coloured sidebar the mark has to read light against navy. */
  onBrand?: boolean;
}) {
  const width = showWordmark ? height * 6.6 : height * 0.95;
  const gradientId = onBrand ? 'mv-mic-light' : 'mv-mic';
  const paint = `url(#${gradientId})`;

  return (
    <svg
      height={height}
      width={width}
      viewBox={showWordmark ? '0 0 400 60' : '0 0 58 60'}
      role="img"
      aria-label="MedVoice AI"
      style={{ display: 'block', flex: 'none' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          {onBrand ? (
            <>
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="var(--brand-glow)" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="var(--brand-light)" />
              <stop offset="55%" stopColor="var(--brand-blue)" />
              <stop offset="100%" stopColor="var(--brand-deep)" />
            </>
          )}
        </linearGradient>
      </defs>

      {/* Microphone body */}
      <rect x="17" y="4" width="24" height="34" rx="12" fill={paint} />

      {/* Waveform inside the capsule — the voice half of the name */}
      <path
        d="M22 22 L24.5 22 L26.5 15.5 L29 29.5 L31.5 18.5 L33.5 24.5 L36 24.5"
        fill="none"
        stroke={onBrand ? 'var(--brand-navy)' : '#fff'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Cradle and stand */}
      <path d="M10 26 a19 19 0 0 0 38 0" fill="none" stroke={paint} strokeWidth="5" strokeLinecap="round" />
      <line x1="29" y1="45" x2="29" y2="53" stroke={paint} strokeWidth="5" strokeLinecap="round" />
      <line x1="19" y1="55" x2="39" y2="55" stroke={paint} strokeWidth="5" strokeLinecap="round" />

      {showWordmark && (
        <text
          x="66"
          y="43"
          fill={onBrand ? '#ffffff' : 'var(--brand-navy)'}
          fontFamily="var(--font-ui)"
          fontSize="40"
          fontWeight="700"
          letterSpacing="-1"
        >
          MedVoice <tspan fontWeight="600">AI</tspan>
        </text>
      )}
    </svg>
  );
}
