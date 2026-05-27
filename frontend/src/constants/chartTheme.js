export const CHART_COLORS = [
  "var(--app-chart-1)",
  "var(--app-chart-2)",
  "var(--app-chart-3)",
  "var(--app-chart-4)",
  "var(--app-chart-5)",
  "var(--app-chart-6)",
  "var(--app-chart-7)",
  "var(--app-chart-8)",
];

export const STATUS_COLORS = {
  ok: "var(--app-success)",
  ng: "var(--app-danger)",
  warning: "var(--app-warning)",
};

export const chartGridProps = {
  strokeDasharray: "3 3",
  stroke: "var(--app-chart-grid)",
  vertical: false,
};

export const chartAxisProps = (fontSize = 10) => ({
  stroke: "var(--app-chart-axis)",
  tick: {
    fontSize,
    fontWeight: 800,
    fill: "var(--app-chart-axis-text)",
  },
});

export const chartCursor = {
  fill: "var(--app-chart-cursor)",
  opacity: 0.35,
};

export const chartLineProps = (color = "var(--app-chart-1)", strokeWidth = 4) => ({
  stroke: color,
  strokeWidth,
  dot: {
    r: 6,
    fill: color,
    strokeWidth: 3,
    stroke: "var(--app-chart-dot-stroke)",
  },
  activeDot: {
    r: 10,
    fill: color,
    stroke: "var(--app-chart-dot-stroke)",
  },
});
