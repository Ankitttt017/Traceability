import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ServerCrash, WifiOff, X } from "lucide-react";
import { API_BASE_URL } from "../api/client";

const SHOW_DELAY_MS = 700;
const RETRY_SECONDS = 8;
const assetBaseUrl = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
const OFFLINE_IMAGE = `${assetBaseUrl}No-Internet.avif`;

function getInitialOfflineState() {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

function resolveHealthUrl() {
  const base = String(API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "/";
  if (base.endsWith("/api/v1")) return `${base.slice(0, -7)}/`;
  if (base.endsWith("/api")) return `${base.slice(0, -4)}/`;
  return `${base}/`;
}

export default function NetworkOutageOverlay() {
  const [offline, setOffline] = useState(getInitialOfflineState);
  const [visible, setVisible] = useState(getInitialOfflineState);
  const [reason, setReason] = useState(getInitialOfflineState() ? "browser" : "");
  const [retryIn, setRetryIn] = useState(RETRY_SECONDS);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let delayRef = null;

    const showOffline = (nextReason = "network") => {
      setReason(nextReason);
      setOffline(true);
      setImageFailed(false);
      setRetryIn(RETRY_SECONDS);
      window.clearTimeout(delayRef);
      delayRef = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    const hideOffline = () => {
      window.clearTimeout(delayRef);
      setOffline(false);
      setVisible(false);
      setReason("");
    };

    const handleBrowserOffline = () => showOffline("browser");
    const handleConnectivity = (event) => {
      const status = String(event?.detail?.status || "").trim().toLowerCase();
      if (status === "online") hideOffline();
      if (status === "offline") showOffline(event?.detail?.reason || "server");
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
  }, []);

  useEffect(() => {
    if (!offline || !visible) return undefined;

    let stopped = false;
    const healthUrl = resolveHealthUrl();

    const probe = async () => {
      if (navigator.onLine === false) {
        setRetryIn(RETRY_SECONDS);
        return;
      }
      try {
        await fetch(healthUrl, {
          method: "GET",
          cache: "no-store",
          mode: "no-cors",
        });
        if (!stopped) window.location.reload();
      } catch {
        if (!stopped) setRetryIn(RETRY_SECONDS);
      }
    };

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
      stopped = true;
      window.clearInterval(timer);
    };
  }, [offline, visible]);

  if (!offline || !visible) return null;

  const isBrowserOffline = reason === "browser";
  const title = isBrowserOffline ? "Network disconnected" : "Server unreachable";
  const Icon = isBrowserOffline ? WifiOff : ServerCrash;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-md">
      <section className="relative w-full max-w-[820px] overflow-hidden rounded-[24px] border border-white/20 bg-white shadow-2xl shadow-black/40">
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          aria-label="Close network outage message"
          title="Close"
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

            <div className="inline-flex w-fit items-center gap-3 rounded-xl border border-amber-200 bg-amber-100 px-5 py-3 text-amber-950">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-base font-black">
                Retrying in {retryIn}s
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
