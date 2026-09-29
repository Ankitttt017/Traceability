import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, ServerCrash, WifiOff, X } from "lucide-react";
import toast from "react-hot-toast";
import { API_BASE_URL } from "../api/client";

const SHOW_DELAY_MS = 2500;
const RETRY_SECONDS = 8;
const SNOOZE_AFTER_CLOSE_MS = 60000;
const assetBaseUrl = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
const OFFLINE_IMAGE = `${assetBaseUrl}No-Internet.avif`;

function getInitialOfflineState() {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

function resolveHealthUrl() {
  const base = String(API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "/api/v1/health";
  if (base.endsWith("/api/v1")) return `${base}/health`;
  if (base.endsWith("/api")) return `${base}/v1/health`;
  return `${base}/api/v1/health`;
}

function resolveFallbackUrl() {
  const base = String(API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "/";
  try {
    const parsed = new URL(base, typeof window !== "undefined" ? window.location.origin : "http://localhost:9090");
    return `${parsed.origin}/`;
  } catch (_e) {
    return "/";
  }
}

export default function NetworkOutageOverlay() {
  const [offline, setOffline] = useState(getInitialOfflineState);
  const [visible, setVisible] = useState(getInitialOfflineState);
  const [reason, setReason] = useState(getInitialOfflineState() ? "browser" : "");
  const [retryIn, setRetryIn] = useState(RETRY_SECONDS);
  const [imageFailed, setImageFailed] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const snoozedUntilRef = useRef(0);

  const hideOffline = useCallback(() => {
    setOffline(false);
    setVisible(false);
    setReason("");
    setIsProbing(false);
    setRetryIn(RETRY_SECONDS);
  }, []);

  const probe = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setRetryIn(RETRY_SECONDS);
      return;
    }

    setIsProbing(true);

    try {
      // 1. Primary probe: dedicated health endpoint
      const healthUrl = resolveHealthUrl();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3500);

      const res = await fetch(healthUrl, {
        method: "GET",
        cache: "no-store",
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);

      if (res.ok) {
        hideOffline();
        toast.success("Server connection restored", { id: "server-online-toast", duration: 3000 });
        window.dispatchEvent(new CustomEvent("traceability:connectivity", {
          detail: { status: "online", restored: true },
        }));
        return;
      }
    } catch (_err) {
      // Primary probe failed, try fallback root
      try {
        const fallbackUrl = resolveFallbackUrl();
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), 2500);

        const res2 = await fetch(fallbackUrl, {
          method: "GET",
          cache: "no-store",
          signal: ctrl2.signal,
        });
        clearTimeout(timer2);

        if (res2.ok || res2.status === 200 || res2.status === 304) {
          hideOffline();
          toast.success("Server connection restored", { id: "server-online-toast", duration: 3000 });
          window.dispatchEvent(new CustomEvent("traceability:connectivity", {
            detail: { status: "online", restored: true },
          }));
          return;
        }
      } catch (_fallbackErr) {
        // Still unreachable
      }
    } finally {
      setIsProbing(false);
      setRetryIn(RETRY_SECONDS);
    }
  }, [hideOffline]);

  useEffect(() => {
    let delayRef = null;

    const showOffline = (nextReason = "network") => {
      // If user closed the popup recently, don't re-show unless browser is offline
      if (Date.now() < snoozedUntilRef.current && nextReason !== "browser") {
        return;
      }

      setReason(nextReason);
      setOffline(true);
      setImageFailed(false);
      setRetryIn(RETRY_SECONDS);
      window.clearTimeout(delayRef);
      delayRef = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    const handleBrowserOffline = () => showOffline("browser");
    const handleConnectivity = (event) => {
      const status = String(event?.detail?.status || "").trim().toLowerCase();
      if (status === "online") {
        window.clearTimeout(delayRef);
        hideOffline();
      } else if (status === "offline") {
        showOffline(event?.detail?.reason || "server");
      }
    };

    window.addEventListener("offline", handleBrowserOffline);
    window.addEventListener("online", hideOffline);
    window.addEventListener("traceability:connectivity", handleConnectivity);

    if (navigator.onLine === false) showOffline("browser");

    return () => {
      window.clearTimeout(delayRef);
      window.removeEventListener("offline", handleBrowserOffline);
      window.removeEventListener("online", hideOffline);
      window.removeEventListener("traceability:connectivity", handleConnectivity);
    };
  }, [hideOffline]);

  // Periodic probe timer while offline and visible
  useEffect(() => {
    if (!offline || !visible) return undefined;

    const timer = window.setInterval(() => {
      setRetryIn((value) => {
        if (value <= 1) {
          void probe();
          return RETRY_SECONDS;
        }
        return value - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [offline, visible, probe]);

  const handleClose = () => {
    setVisible(false);
    // Snooze for 60 seconds so user isn't spammed while working
    snoozedUntilRef.current = Date.now() + SNOOZE_AFTER_CLOSE_MS;
  };

  const handleManualReload = () => {
    window.location.reload();
  };

  if (!offline || !visible) return null;

  const isBrowserOffline = reason === "browser";
  const title = isBrowserOffline ? "Network disconnected" : "Server unreachable";
  const Icon = isBrowserOffline ? WifiOff : ServerCrash;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-md animate-fade-in">
      <section className="relative w-full max-w-[820px] overflow-hidden rounded-[24px] border border-white/20 bg-white shadow-2xl shadow-black/40">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          aria-label="Close network outage message"
          title="Dismiss for 1 minute"
        >
          <X size={17} strokeWidth={2.6} />
        </button>
        <div className="grid md:grid-cols-[0.95fr_1.05fr]">
          <div className="relative flex min-h-[300px] items-center justify-center bg-white p-6">
            <div className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-red-600">
              <AlertTriangle size={14} />
              Offline
            </div>
            {imageFailed ? (
              <div className="mt-8 flex h-[260px] w-full max-w-[360px] flex-col items-center justify-center rounded-3xl border border-red-100 bg-red-50 text-red-600">
                <WifiOff size={78} strokeWidth={1.8} />
                <p className="mt-5 text-xl font-black text-slate-900">Network issue</p>
                <p className="mt-2 text-center text-sm font-bold text-slate-600">Check LAN, Wi-Fi, router, or server.</p>
              </div>
            ) : (
              <img
                src={OFFLINE_IMAGE}
                alt="Network disconnected"
                className="mt-8 h-auto max-h-[315px] w-full max-w-[360px] object-contain"
                draggable="false"
                onError={() => setImageFailed(true)}
              />
            )}
          </div>

          <div className="flex flex-col justify-center gap-5 bg-slate-50 p-7 sm:p-9">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-red-300 bg-red-100 text-red-600 shadow-sm">
                <Icon size={28} />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.24em] text-red-500">
                  Connection Lost
                </p>
                <h1 className="mt-1 text-3xl font-black leading-tight text-slate-950 sm:text-4xl">
                  {title}
                </h1>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-lg font-bold leading-7 text-slate-800">
                Check Wi-Fi, LAN cable, router, or server.
              </p>
              <p className="mt-2 text-lg font-bold leading-7 text-slate-800">
                वाई-फाई, LAN केबल, राउटर या सर्वर जांचें।
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-100 px-5 py-2.5 text-amber-950">
                <Loader2 size={18} className="animate-spin text-amber-700" />
                <span className="text-sm font-black">
                  {isProbing ? "Checking connection..." : `Retrying in ${retryIn}s`}
                </span>
              </div>

              <button
                type="button"
                onClick={() => void probe()}
                disabled={isProbing}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-95 disabled:opacity-50 text-white font-bold px-4 py-2.5 text-sm shadow-md transition"
              >
                <RefreshCw size={15} className={isProbing ? "animate-spin" : ""} />
                Retry Now
              </button>

              <button
                type="button"
                onClick={handleManualReload}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 active:scale-95 text-slate-700 font-semibold px-3.5 py-2.5 text-xs shadow-sm transition"
                title="Reload the entire application page"
              >
                <RotateCcw size={13} />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
