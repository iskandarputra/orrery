/**
 * The Orrery mark.
 *
 * An orrery is a clockwork model of a solar system, so the mark is one: a
 * centre, two orbits, and a body on each. It replaced a rounded square holding
 * a letter `z`, which was left over from the name the app had before this one
 * and said nothing about either name.
 *
 * Drawn rather than lettered on purpose. A letter mark has to be read, which
 * makes it useless at the sizes an application icon actually appears at, and it
 * ties the identity to a spelling. This one is four shapes and reads as a
 * system of orbits at 16 pixels, which is where a window icon and a tab
 * favicon live.
 *
 * The orbits are tilted ellipses, not circles. Concentric circles read as a
 * target; tilted, they read as something seen at an angle, which is what an
 * orrery looks like on a desk. The tilt also keeps the two bodies clear of each
 * other without needing a third element to separate them.
 *
 * Inline SVG so it stays crisp at any size and follows the interface it sits
 * in. `build/icon.png` is generated from this by `./orrery.sh icon`, so the
 * window icon and the mark in the app cannot drift apart.
 */
export function Logo({ size = 40 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="Orrery">
      <defs>
        <linearGradient
          id="or-logo-grad"
          x1="0"
          y1="0"
          x2="48"
          y2="48"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4f6ef2" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>

      <rect x="3.5" y="3.5" width="41" height="41" rx="11" fill="url(#or-logo-grad)" />

      {/*
        Two orbits at different tilts, so they cross.

        They started concentric and sharing a tilt, which looked tidy and read
        as an eye: an outline with a filled dot at its centre is an iris and a
        pupil, and flattening the inner one only made it a narrower eye. Crossed
        planes cannot be read that way, and they are also what an orrery on a
        desk actually looks like, since the planes of a solar system do not
        agree either.
      */}
      <ellipse
        cx="24"
        cy="24"
        rx="16"
        ry="6.6"
        transform="rotate(-24 24 24)"
        stroke="#fff"
        strokeOpacity="0.68"
        strokeWidth="2.1"
      />
      <ellipse
        cx="24"
        cy="24"
        rx="11.6"
        ry="5"
        transform="rotate(38 24 24)"
        stroke="#fff"
        strokeWidth="2.1"
      />

      {/* The sun, and a body on each orbit. Opposite sides of the centre, so
          the mark is not weighted into one corner, and each sits exactly on its
          own curve rather than near it. */}
      <circle cx="24" cy="24" r="3" fill="#fff" />
      <circle cx="38.62" cy="17.49" r="2.7" fill="#fff" />
      <circle cx="18.66" cy="25.96" r="2.15" fill="#fff" />
    </svg>
  )
}
