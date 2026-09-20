import clsx from "clsx";

/** Netflix-style rounded smiley avatar on a colored tile */
export default function Avatar({
  color,
  kids,
  className = "w-10 h-10",
  rounded = "rounded-md",
}: {
  color: string;
  kids?: boolean;
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      className={clsx("relative flex items-center justify-center overflow-hidden", rounded, className)}
      style={{ backgroundColor: color }}
    >
      <svg viewBox="0 0 48 48" className="w-[78%] h-[78%]" aria-hidden>
        {/* face */}
        <circle cx="24" cy="18" r="7.5" fill="rgba(0,0,0,0.82)" />
        <path
          d={kids ? "M12 40c2-7 7-10 12-10s10 3 12 10" : "M10 40c3-8 8-11 14-11s11 3 14 11"}
          fill="rgba(0,0,0,0.82)"
        />
        {/* eyes */}
        <circle cx="21" cy="17" r="1.7" fill="#fff" />
        <circle cx="27" cy="17" r="1.7" fill="#fff" />
        {/* smile */}
        <path d={kids ? "M20.5 22.5q3.5 3 7 0" : "M20 22.5q4 3.4 8 0"} stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
    </div>
  );
}
