import React from "react";
import { Activity } from "lucide-react";

// ── Rejection Analysis Full Skeleton Shimmer Placeholder ─────────────────────
const RejectionAnalysisSkeleton = React.memo(() => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 4 }}>
      {/* Dynamic Shimmer Banner */}
      <div className="rej-skeleton-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            className="rej-skeleton-box rej-skeleton-circle"
            style={{
              width: 38,
              height: 38,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(37, 99, 235, 0.15)",
              color: "#2563eb",
            }}
          >
            <Activity size={20} className="animate-pulse" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: "#1e3a8a" }}>
                Analyzing Live Production Quality Intelligence
              </span>
              <span style={{ fontSize: 11, background: "#dbeafe", color: "#1e40af", padding: "1px 8px", borderRadius: 99, fontWeight: 700 }}>
                Aggregating Telemetry...
              </span>
            </div>
            <div className="rej-skeleton-box" style={{ width: 440, height: 11 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="rej-skeleton-box" style={{ width: 110, height: 28, borderRadius: 20 }} />
          <div className="rej-skeleton-box" style={{ width: 110, height: 28, borderRadius: 20 }} />
        </div>
      </div>

      {/* KPI Stats Skeleton Grid */}
      <div className="rej-kpi-grid">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rej-skeleton-kpi-card">
            <div className="rej-skeleton-box rej-skeleton-circle" style={{ width: 46, height: 46, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="rej-skeleton-box" style={{ width: "55%", height: 11, marginBottom: 8 }} />
              <div className="rej-skeleton-box" style={{ width: "75%", height: 24, marginBottom: 6 }} />
              <div className="rej-skeleton-box" style={{ width: "45%", height: 10 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Speedometer Pipeline Carousel Skeleton */}
      <div className="rej-card">
        <div className="rej-card-header" style={{ marginBottom: 16 }}>
          <div>
            <div className="rej-skeleton-box" style={{ width: 380, height: 18, marginBottom: 6 }} />
            <div className="rej-skeleton-box" style={{ width: 540, height: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="rej-skeleton-box" style={{ width: 130, height: 26, borderRadius: 20 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, overflow: "hidden", padding: "4px 0" }}>
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="rej-skeleton-gate-card">
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 8 }}>
                <div className="rej-skeleton-box" style={{ width: 55, height: 16, borderRadius: 4 }} />
                <div className="rej-skeleton-box" style={{ width: 48, height: 16, borderRadius: 10 }} />
              </div>
              <div className="rej-skeleton-box" style={{ width: 110, height: 12, marginBottom: 6 }} />
              {/* Semicircle Speedometer Outline */}
              <div
                className="rej-skeleton-box"
                style={{
                  width: 108,
                  height: 54,
                  borderTopLeftRadius: 54,
                  borderTopRightRadius: 54,
                  marginBottom: 10,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <div className="rej-skeleton-box" style={{ width: 42, height: 10 }} />
                <div className="rej-skeleton-box" style={{ width: 42, height: 10 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Two Column Visualizer Skeleton */}
      <div className="rej-two-col">
        <div className="rej-card" style={{ height: 380, display: "flex", flexDirection: "column" }}>
          <div className="rej-card-header" style={{ marginBottom: 14 }}>
            <div>
              <div className="rej-skeleton-box" style={{ width: 220, height: 16, marginBottom: 6 }} />
              <div className="rej-skeleton-box" style={{ width: 340, height: 11 }} />
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 14, padding: "10px 16px" }}>
            {[65, 40, 85, 30, 95, 55, 70, 45, 60].map((h, idx) => (
              <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div className="rej-skeleton-bar" style={{ height: `${h * 2.5}px` }} />
                <div className="rej-skeleton-box" style={{ width: "80%", height: 10 }} />
              </div>
            ))}
          </div>
        </div>

        <div className="rej-card" style={{ height: 380, display: "flex", flexDirection: "column" }}>
          <div className="rej-card-header" style={{ marginBottom: 14 }}>
            <div>
              <div className="rej-skeleton-box" style={{ width: 200, height: 16, marginBottom: 6 }} />
              <div className="rej-skeleton-box" style={{ width: 280, height: 11 }} />
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div
              className="rej-skeleton-box rej-skeleton-circle"
              style={{ width: 200, height: 200, border: "24px solid #e2e8f0" }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Full-Width Chart Skeleton */}
      <div className="rej-card" style={{ height: 320 }}>
        <div className="rej-card-header" style={{ marginBottom: 14 }}>
          <div>
            <div className="rej-skeleton-box" style={{ width: 280, height: 16, marginBottom: 6 }} />
            <div className="rej-skeleton-box" style={{ width: 420, height: 11 }} />
          </div>
        </div>
        <div style={{ height: 210, display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "10px 24px" }}>
          {[45, 70, 55, 80, 60, 90, 75, 50, 65, 85, 40, 95].map((h, idx) => (
            <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div className="rej-skeleton-bar" style={{ height: `${h * 2.2}px` }} />
              <div className="rej-skeleton-box" style={{ width: 50, height: 10 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default RejectionAnalysisSkeleton;
