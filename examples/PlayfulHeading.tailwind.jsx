/**
 * React + Tailwind example: bubbly / hand-drawn style headline.
 * Requires: tailwind + @tailwindcss/typography (optional) + Google Fonts (Baloo 2) in index.html:
 *
 * <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@800&display=swap" rel="stylesheet" />
 *
 * tailwind.config.js → theme.extend.fontFamily.playful: ['"Baloo 2"', 'cursive']
 */

export function PlayfulHeading({ lines = ["Scroll", "Cook", "Repeat"], className = "" }) {
  return (
    <h1
      className={`font-playful text-[clamp(2.5rem,12vw,4.5rem)] font-extrabold uppercase leading-[0.98] tracking-[0.06em] text-[#1E5BB8] [text-shadow:0_2px_0_rgb(255_255_255/0.55),0_4px_12px_rgb(30_91_184/0.22)] ${className}`}
      aria-label={lines.join(" ")}
    >
      {lines.map((word, lineIdx) => (
        <span key={lineIdx} className="block">
          {[...word].map((ch, i) => (
            <span
              key={`${lineIdx}-${i}`}
              className="inline-block"
              style={{
                // Slight wobble per letter (index resets each line)
                transform: `rotate(${-2 + i * 1.35}deg) translateY(${-0.04 + i * 0.028}em)`,
              }}
            >
              {ch}
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}
