import { cn } from "../../primitives/cn";

// The Gleam mark's six segments, traced from the extension icon.
const MARK_SEGMENTS = [
  "M265.5 6 514 149.5 417.5 205 265 116.5Z",
  "M255.5 7 256.5 117 103.5 205 9 149.5Z",
  "M515.5 157 516.5 443 422 388.5 422.5 211Z",
  "M4.5 156 100 210.5 101 387.5 4.5 444Z",
  "M417.5 395 513 449.5 264.5 594 264 484.5Z",
  "M102.5 395 258 484.5 257.5 594 8 450.5Z",
];

function Layer({ fill, dy }: { fill: string; dy: number }) {
  return (
    <g fill={fill} transform={`translate(0 ${dy})`}>
      {MARK_SEGMENTS.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );
}

/**
 * The Gleam mark embossed into the paper theme's token sheet, like the
 * watermark on a banknote. Drawn in the sheet's own colour with a light
 * edge above and a shadow below, so it reads as pressed in, not printed.
 * Hidden in every other theme.
 */
export function PaperWatermark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="-10 -10 543 617" className={cn("mx-auto hidden h-32 w-28 paper:block", className)}>
      <Layer fill="#ffffff" dy={-6} />
      <Layer fill="rgba(40, 35, 25, 0.07)" dy={6} />
      <Layer fill="var(--color-surface)" dy={0} />
    </svg>
  );
}
