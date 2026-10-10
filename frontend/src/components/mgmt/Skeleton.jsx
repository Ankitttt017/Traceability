import React from "react";

/** Shimmer placeholder block. */
export default function Skeleton({ height = 16, width = "100%", radius = 8, style }) {
  return <div className="mg-skel" aria-hidden="true" style={{ height, width, borderRadius: radius, ...style }} />;
}

/** A few stacked skeleton lines — the default loading state of a section body. */
export function SkeletonBlock({ lines = 4, height = 220 }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: height, justifyContent: "center" }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={i === 0 ? 20 : 14} width={`${92 - ((i * 17) % 40)}%`} />
      ))}
    </div>
  );
}
