import { cn } from "@/lib/utils";
import { useId } from "react";

interface GrimoireLogoProps {
  className?: string;
  size?: number;
  /**
   * Which gradient style to use:
   * - "original": The original radial gradient (orange -> purple -> blue)
   * - "theme": Linear gradient matching text-grimoire-gradient (yellow -> orange -> purple -> cyan)
   */
  gradient?: "original" | "theme";
}

/**
 * Grimoire logo with the signature gradient.
 * The logo shape is a stylized pentagram/grimoire icon with a star element.
 */
export function GrimoireLogo({
  className,
  size = 160,
  gradient = "original",
}: GrimoireLogoProps) {
  // Maintain original aspect ratio (122:160)
  const width = (size * 122) / 160;
  const height = size;

  // Use unique ID to avoid conflicts when multiple logos are on the page
  const gradientId = useId();

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 122 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(className)}
      aria-label="Grimoire logo"
    >
      <g transform="translate(0.5, 0)">
        <path
          d="M99.9028 38.8215C100.25 39.0958 100.453 39.5134 100.453 39.9553V62.7095C100.453 63.5082 99.8036 64.1556 99.0027 64.1556H81.8124C81.0115 64.1556 80.3622 63.5082 80.3622 62.7095V49.645C80.3622 49.2031 80.1596 48.7854 79.8122 48.5111L51.1258 25.8633C50.5984 25.4469 49.853 25.4469 49.3256 25.8633L20.6406 48.5111C20.2932 48.7854 20.0906 49.2031 20.0906 49.645V110.352C20.0906 110.794 20.2932 111.212 20.6406 111.486L49.3256 134.134C49.853 134.55 50.5984 134.55 51.1258 134.134L72.9219 116.925C73.6317 116.364 73.6587 115.299 72.9782 114.704L60.3109 103.619C59.3516 102.78 59.869 101.203 61.1403 101.091L80.3924 99.4036C80.9294 99.3566 81.3958 99.0163 81.6036 98.5203L89.0687 80.6918C89.565 79.5066 91.2487 79.5066 91.7449 80.6918L99.2101 98.5203C99.4178 99.0163 99.8843 99.3566 100.421 99.4036L119.675 101.091C120.946 101.203 121.464 102.78 120.504 103.619L105.912 116.389C105.511 116.74 105.336 117.281 105.455 117.799L109.8 136.764C110.086 138.012 108.726 138.987 107.631 138.32L91.8717 128.724C91.3531 128.408 90.6922 128.448 90.2159 128.824L51.1258 159.688C50.5984 160.104 49.853 160.104 49.3256 159.688L0.550024 121.179C0.202601 120.904 0 120.487 0 120.045V39.9553C0 39.5134 0.202601 39.0957 0.550024 38.8215L49.3256 0.312306C49.853 -0.104099 50.5984 -0.104102 51.1258 0.312296L99.9028 38.8215Z"
          fill={`url(#${gradientId})`}
        />
      </g>
      <defs>
        {gradient === "original" ? (
          <radialGradient
            id={gradientId}
            cx="0"
            cy="0"
            r="1"
            gradientTransform="matrix(201.667 256.092 -193.67 266.667 -8.78247e-06 -0.459781)"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#F9913E" />
            <stop offset="0.480769" stopColor="#A05CF6" />
            <stop offset="1" stopColor="#7188F3" />
          </radialGradient>
        ) : (
          <linearGradient
            id={gradientId}
            x1="60.5"
            y1="0"
            x2="60.5"
            y2="160"
            gradientUnits="userSpaceOnUse"
          >
            {/* Matches text-grimoire-gradient CSS variables */}
            <stop offset="0%" stopColor="rgb(var(--gradient-1))" />
            <stop offset="33%" stopColor="rgb(var(--gradient-2))" />
            <stop offset="66%" stopColor="rgb(var(--gradient-3))" />
            <stop offset="100%" stopColor="rgb(var(--gradient-4))" />
          </linearGradient>
        )}
      </defs>
    </svg>
  );
}
