/**
 * Cork.
 * The full stop is a push pin — the smallest possible version of the product.
 */
export function Wordmark({
  size = 22,
  tone = 'ink',
}: {
  size?: number;
  tone?: 'ink' | 'cream';
}) {
  const color = tone === 'cream' ? '#fdf6e8' : '#241d18';
  const dot = size * 0.245;

  return (
    <span
      className="inline-flex select-none items-baseline"
      style={{ fontSize: size, letterSpacing: '-0.045em', fontWeight: 800, color, lineHeight: 1 }}
      aria-label="Cork."
    >
      Cork
      <span
        aria-hidden="true"
        className="relative inline-block"
        style={{
          width: dot,
          height: dot,
          marginLeft: size * 0.07,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 34% 28%, #ee8b74 0%, #c8422f 46%, #802015 100%)',
          boxShadow: `0 ${size * 0.03}px ${size * 0.06}px rgba(80,26,14,0.45), inset 0 0 0 0.5px rgba(90,24,12,0.5)`,
        }}
      >
        <span
          className="absolute rounded-full bg-white"
          style={{
            width: dot * 0.34,
            height: dot * 0.28,
            left: dot * 0.18,
            top: dot * 0.16,
            opacity: 0.75,
          }}
        />
      </span>
    </span>
  );
}
