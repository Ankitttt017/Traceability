import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Boxes, PackageCheck, ScanLine, Search, RefreshCw } from "lucide-react";
import { packingApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

function getSessionFromResponse(response) {
  if (!response) {
    return null;
  }
  if (response.activeSession) {
    return response.activeSession;
  }
  return response;
}

const Packing = () => {
  const [overview, setOverview] = useState({ activeSession: null, activeItems: [], recentSessions: [] });
  const [boxNumber, setBoxNumber] = useState("");
  const [searchBox, setSearchBox] = useState("");
  const [searchedSession, setSearchedSession] = useState(null);
  const [popup, setPopup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [feed, setFeed] = useState([]);

  const activeSession = overview.activeSession;
  const activeItems = useMemo(() => overview.activeItems || [], [overview.activeItems]);
  const capacity = Number(activeSession?.capacity || 65);

  const filledSlots = useMemo(() => {
    const map = new Map();
    for (const item of activeItems) {
      map.set(Number(item.slotNo), item.partId);
    }
    return map;
  }, [activeItems]);

  const loadOverview = async () => {
    const data = await packingApi.overview();
    setOverview({
      activeSession: data.activeSession,
      activeItems: data.activeItems || [],
      recentSessions: data.recentSessions || [],
    });
  };

  useEffect(() => {
    loadOverview().catch((error) => {
      setPopup({
        type: "ERROR",
        title: "Packing Load Error",
        message: error.response?.data?.error || "Unable to load packing overview",
      });
    });
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });

    socket.on("packing_update", (payload = {}) => {
      setOverview((prev) => {
        const session = {
          id: payload.sessionId,
          boxNumber: payload.boxNumber,
          capacity: payload.capacity,
          packedCount: payload.packedCount,
          status: payload.status,
        };

        const currentItems = Array.isArray(prev.activeItems) ? [...prev.activeItems] : [];
        if (payload.slotNo && payload.partId) {
          const exists = currentItems.some((item) => Number(item.slotNo) === Number(payload.slotNo));
          if (!exists) {
            currentItems.push({
              id: `${payload.sessionId}-${payload.slotNo}`,
              slotNo: Number(payload.slotNo),
              partId: payload.partId,
            });
            currentItems.sort((a, b) => Number(a.slotNo) - Number(b.slotNo));
          }
        }

        return {
          ...prev,
          activeSession: session,
          activeItems: currentItems,
        };
      });

      setFeed((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random()}`,
            message: `Packed ${payload.partId || "-"} in ${payload.boxNumber || "-"} slot ${payload.slotNo || "-"}`,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 20)
      );
    });

    socket.on("operator_popup", (payload = {}) => {
      if (payload.stationNo === "PACKING" || String(payload.message || "").toUpperCase().includes("PACK")) {
        setPopup(payload);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleStartBox = async (event) => {
    event.preventDefault();
    const value = boxNumber.trim().toUpperCase();
    if (!value) {
      return;
    }
    setLoading(true);
    try {
      await packingApi.startBox({
        boxNumber: value,
        capacity: 65,
      });
      setBoxNumber("");
      await loadOverview();
      setPopup({
        type: "SUCCESS",
        title: "Box Ready",
        message: `Box ${value} opened. Scanner can now fill slots automatically.`,
      });
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Start Box Failed",
        message: error.response?.data?.error || "Unable to start box",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearchBox = async (event) => {
    event.preventDefault();
    const value = searchBox.trim().toUpperCase();
    if (!value) {
      return;
    }
    setLoading(true);
    try {
      const data = await packingApi.boxByNumber(value);
      const session = getSessionFromResponse(data);
      setSearchedSession(session);
    } catch (error) {
      setSearchedSession(null);
      setPopup({
        type: "ERROR",
        title: "Box Not Found",
        message: error.response?.data?.error || "No session found for this box",
      });
    } finally {
      setLoading(false);
    }
  };

  const progress = activeSession ? Math.min(100, Math.round(((activeSession.packedCount || 0) / capacity) * 100)) : 0;

  return (
    <div className="space-y-6">
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <Boxes className="text-primary" size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Packing Station</h1>
            <p className="text-text-muted text-sm">
              Box/part scans are consumed from scanner Ethernet feed. UI auto-fills slots in real-time.
            </p>
          </div>
        </div>
        <button
          onClick={() => loadOverview().catch(() => {})}
          className="px-3 py-2 rounded-lg bg-bg-card border border-border text-text-muted hover:border-primary inline-flex items-center gap-2"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 industrial-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <p className="text-xs uppercase text-text-muted">Active Box</p>
              <p className="text-xl font-bold text-primary font-mono">{activeSession?.boxNumber || "-"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase text-text-muted">Progress</p>
              <p className="text-xl font-bold text-white">
                {activeSession ? `${activeSession.packedCount}/${capacity}` : "0/65"}
              </p>
            </div>
          </div>

          <div className="w-full bg-bg-dark rounded-full h-2.5 border border-border">
            <div className="bg-primary h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-text-muted mt-2">{progress}% filled</p>

          <div className="mt-5 grid grid-cols-5 sm:grid-cols-10 gap-2">
            {Array.from({ length: capacity }, (_, index) => {
              const slotNo = index + 1;
              const part = filledSlots.get(slotNo);
              return (
                <div
                  key={slotNo}
                  className={`h-9 rounded-md border flex items-center justify-center text-[11px] font-mono ${
                    part
                      ? "bg-accent/20 border-accent/40 text-accent"
                      : "bg-bg-dark border-border text-text-muted"
                  }`}
                  title={part ? `Slot ${slotNo}: ${part}` : `Slot ${slotNo}: empty`}
                >
                  {slotNo}
                </div>
              );
            })}
          </div>
        </div>

        <div className="industrial-card p-6 space-y-4">
          <h2 className="font-bold text-white flex items-center gap-2">
            <ScanLine size={18} className="text-primary" />
            Box Controls
          </h2>

          <form onSubmit={handleStartBox} className="space-y-2">
            <label className="text-xs text-text-muted uppercase font-bold">Start New Box</label>
            <input
              value={boxNumber}
              onChange={(e) => setBoxNumber(e.target.value.toUpperCase())}
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none font-mono"
              placeholder="Scan/enter box number"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-primary text-bg-dark font-bold hover:brightness-110 disabled:opacity-60"
            >
              {loading ? "Starting..." : "Start Box"}
            </button>
          </form>

          <form onSubmit={handleSearchBox} className="space-y-2">
            <label className="text-xs text-text-muted uppercase font-bold">Search Box</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={searchBox}
                onChange={(e) => setSearchBox(e.target.value.toUpperCase())}
                className="w-full bg-bg-dark border border-border rounded-lg py-3 pl-9 pr-3 text-text-main focus:border-primary outline-none font-mono"
                placeholder="BOX-0001"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg border border-border text-text-main hover:border-primary disabled:opacity-60"
            >
              Search Session
            </button>
          </form>

          {searchedSession && (
            <div className="p-3 rounded-lg bg-bg-dark border border-border">
              <p className="text-xs text-text-muted uppercase">Session</p>
              <p className="text-sm font-mono text-primary">{searchedSession.boxNumber}</p>
              <p className="text-xs text-text-muted mt-1">
                {searchedSession.packedCount}/{searchedSession.capacity} | {searchedSession.status}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="industrial-card p-6">
          <h2 className="font-bold text-white mb-3 flex items-center gap-2">
            <PackageCheck size={18} className="text-primary" />
            Live Packing Feed
          </h2>
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {feed.map((row) => (
              <div key={row.id} className="p-3 rounded-lg bg-bg-dark border border-border">
                <p className="text-sm text-text-main">{row.message}</p>
                <p className="text-xs text-text-muted mt-1">{new Date(row.timestamp).toLocaleString()}</p>
              </div>
            ))}
            {feed.length === 0 && <p className="text-sm text-text-muted">Waiting for packing events from scanner TCP.</p>}
          </div>
        </div>

        <div className="industrial-card p-6">
          <h2 className="font-bold text-white mb-3">Recent Box Sessions</h2>
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {(overview.recentSessions || []).map((session) => (
              <div key={session.id} className="p-3 rounded-lg bg-bg-dark border border-border">
                <p className="text-sm font-mono text-primary">{session.boxNumber}</p>
                <p className="text-xs text-text-muted mt-1">
                  {session.packedCount}/{session.capacity} | {session.status}
                </p>
                <p className="text-xs text-text-muted">{new Date(session.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {(overview.recentSessions || []).length === 0 && (
              <p className="text-sm text-text-muted">No packing sessions available.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Packing;
