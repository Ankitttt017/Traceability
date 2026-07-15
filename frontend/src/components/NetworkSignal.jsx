import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../api/client";

const POLL_MS = 5000;
const REQUEST_TIMEOUT_MS = 2500;

function resolveHealthUrl() {
  const base = String(API_BASE_URL || "").trim();
  const normalized = base.replace(/\/+$/, "");
  // Use public root endpoint to avoid auth-protected API routes.
  if (!normalized) return "/";
  if (normalized.endsWith("/api/v1")) return `${normalized.slice(0, -7)}/`;
  if (normalized.endsWith("/api")) return `${normalized.slice(0, -4)}/`;
  return `${normalized}/`;
}

function barsFromLatency(latencyMs, ok) {
  if (!ok) return { bars: 0, tone: "bg-slate-400/70" };
  if (latencyMs < 100) return { bars: 4, tone: "bg-emerald-500" };
  if (latencyMs < 300) return { bars: 3, tone: "bg-emerald-500" };
  if (latencyMs < 800) return { bars: 2, tone: "bg-amber-400" };
  return { bars: 1, tone: "bg-red-500" };
}

export default function NetworkSignal() {
  const [bars, setBars] = useState(0);
  const [tone, setTone] = useState("bg-slate-400/70");
  const [online, setOnline] = useState(true);
  const healthUrl = useMemo(() => resolveHealthUrl(), []);

  useEffect(() => {
    let timerRef = null;
    let mounted = true;

    const probe = async () => {
      const controller = new AbortController();
      const timeoutRef = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const start = performance.now();
      try {
        const res = await fetch(healthUrl, {
          method: "GET",
          cache: "no-store",
          mode: "no-cors",
          signal: controller.signal,
        });
        const latency = Math.max(0, Math.round(performance.now() - start));
        // In no-cors mode response is opaque; successful resolve means reachable.
        const score = barsFromLatency(latency, Boolean(res));
        if (!mounted) return;
        setBars(score.bars);
        setTone(score.tone);
        setOnline(Boolean(res));
      } catch (_err) {
        if (!mounted) return;
        setBars(0);
        setTone("bg-slate-400/70");
        setOnline(false);
      } finally {
        clearTimeout(timeoutRef);
      }
    };

    probe();
    timerRef = setInterval(probe, POLL_MS);

    return () => {
      mounted = false;
      if (timerRef) clearInterval(timerRef);
    };
  }, [healthUrl]);

  const heights = [8, 12, 16, 20];

  return (
    <div
      className="inline-flex items-end gap-1 px-2 py-1 rounded-lg "
      title={online ? "Network connectivity" : "Network disconnected"}
      aria-label="Network signal"
    >
      {heights.map((h, i) => {
        const active = i < bars;
        return (
          <span
            key={h}
            className={`w-[3px] rounded-sm transition-all duration-300 ease-out ${active ? tone : "bg-text-muted/30"}`}
            style={{ height: h }}
          />
        );
      })}
    </div>
  );
}
