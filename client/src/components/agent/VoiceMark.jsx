/**
 * The assistant's mark.
 *
 * Five bars that sit still when idle and move when the microphone is open, so
 * the icon itself reports state rather than relying on a label. The animation
 * is CSS, so it costs nothing and respects the reduced-motion rule already in
 * the stylesheet.
 */
export default function VoiceMark({ state = "idle", size = 22 }) {
  // Resting heights, tallest in the middle - a voice, not a bar chart.
  const bars = [
    { x: 2, h: 6 },
    { x: 7, h: 12 },
    { x: 12, h: 18 },
    { x: 17, h: 12 },
    { x: 22, h: 6 },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
      className={`voice-mark is-${state}`}
      aria-hidden="true"
    >
      {bars.map((bar, i) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={(26 - bar.h) / 2}
          width="2.5"
          height={bar.h}
          rx="1.25"
          fill="currentColor"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </svg>
  );
}
