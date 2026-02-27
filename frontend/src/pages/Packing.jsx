import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Boxes, PackageCheck, ScanLine, Search, RefreshCw } from "lucide-react";
import { packingApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const LOCAL_STORAGE_BOX_CAPACITY_KEY = "packing-default-capacity";
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 500;

function normalizeCapacity(value, fallback = 65) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.round(parsed)));
}

function readStoredCapacity() {
  if (typeof window === "undefined") {
    return 65;
  }
  return normalizeCapacity(localStorage.getItem(LOCAL_STORAGE_BOX_CAPACITY_KEY), 65);
}

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
  const [newBoxCapacity, setNewBoxCapacity] = useState(() => readStoredCapacity());
  const [editBoxNumber, setEditBoxNumber] = useState("");
  const [editCapacity, setEditCapacity] = useState(() => readStoredCapacity());
  const [searchBox, setSearchBox] = useState("");
  const [searchedSession, setSearchedSession] = useState(null);
  const [popup, setPopup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updatingBox, setUpdatingBox] = useState(false);
  const [deletingBox, setDeletingBox] = useState(false);
  const [feed, setFeed] = useState([]);
  const [hoveredSlot, setHoveredSlot] = useState(null);

  const activeSession = overview.activeSession;
  const activeItems = useMemo(() => overview.activeItems || [], [overview.activeItems]);
  const capacity = normalizeCapacity(activeSession?.capacity, newBoxCapacity);

  const filledSlots = useMemo(() => {
    const map = new Map();
    for (const item of activeItems) {
      map.set(Number(item.slotNo), item.partId);
    }
    return map;
  }, [activeItems]);

  useEffect(() => {
    if (!activeSession) {
      setEditBoxNumber("");
      setEditCapacity(readStoredCapacity());
      return;
    }
    setEditBoxNumber(activeSession.boxNumber || "");
    setEditCapacity(normalizeCapacity(activeSession.capacity, readStoredCapacity()));
  }, [activeSession, activeSession?.id, activeSession?.boxNumber, activeSession?.capacity]);

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
        if (payload.event === "BOX_DELETED") {
          const isDeletedActive = Number(prev.activeSession?.id || 0) === Number(payload.sessionId || 0);
          return {
            ...prev,
            activeSession: isDeletedActive ? null : prev.activeSession,
            activeItems: isDeletedActive ? [] : prev.activeItems,
          };
        }

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

      const event = String(payload.event || "").toUpperCase();
      const message =
        event === "BOX_UPDATED"
          ? `Box updated: ${payload.boxNumber || "-"} (capacity ${payload.capacity || "-"})`
          : event === "BOX_DELETED"
          ? `Box deleted: ${payload.boxNumber || "-"}`
          : `Packed ${payload.partId || "-"} in ${payload.boxNumber || "-"} slot ${payload.slotNo || "-"}`;

      setFeed((prev) => [{ id: `${Date.now()}-${Math.random()}`, message, timestamp: new Date().toISOString() }, ...prev].slice(0, 20));
    });

    socket.on("operator_popup", (payload = {}) => {
      if (payload.stationNo === "PACKING" || String(payload.message || "").toUpperCase().includes("PACK")) {
        setPopup((prev) => ({
          ...prev,
          ...(payload.qrResult && { qrResult: payload.qrResult }),
          ...(payload.plcStatus && { plcStatus: payload.plcStatus }),
          ...(payload.message && { message: payload.message }),
          ...(payload.partId && { partId: payload.partId }),
          ...(payload.stationNo && { stationNo: payload.stationNo }),
          ...(payload.type && { type: payload.type }),
          ...(payload.title && { title: payload.title }),
        }));
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
      const requestedCapacity = normalizeCapacity(newBoxCapacity, 65);
      await packingApi.startBox({
        boxNumber: value,
        capacity: requestedCapacity,
      });
      setBoxNumber("");
      setNewBoxCapacity(requestedCapacity);
      localStorage.setItem(LOCAL_STORAGE_BOX_CAPACITY_KEY, String(requestedCapacity));
      await loadOverview();
      setPopup({
        type: "SUCCESS",
        title: "Box Ready",
        message: `Box ${value} opened with capacity ${requestedCapacity}. Scanner can now fill slots automatically.`,
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

  const handleUpdateBox = async (event) => {
    event.preventDefault();
    if (!activeSession?.id) {
      return;
    }

    const nextBox = String(editBoxNumber || "").trim().toUpperCase();
    if (!nextBox) {
      setPopup({
        type: "ERROR",
        title: "Update Failed",
        message: "Box number is required",
      });
      return;
    }

    const nextCapacity = normalizeCapacity(editCapacity, capacity);
    setUpdatingBox(true);
    try {
      await packingApi.updateBox(activeSession.id, {
        boxNumber: nextBox,
        capacity: nextCapacity,
      });
      localStorage.setItem(LOCAL_STORAGE_BOX_CAPACITY_KEY, String(nextCapacity));
      await loadOverview();
      setPopup({
        type: "SUCCESS",
        title: "Box Updated",
        message: `Box updated to ${nextBox} with capacity ${nextCapacity}.`,
      });
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Update Failed",
        message: error.response?.data?.error || "Unable to update active box",
      });
    } finally {
      setUpdatingBox(false);
    }
  };

  const handleDeleteBox = async () => {
    if (!activeSession?.id || deletingBox) {
      return;
    }

    const confirmDelete = window.confirm(
      `Delete box ${activeSession.boxNumber}? Only empty boxes can be deleted.`
    );
    if (!confirmDelete) {
      return;
    }

    setDeletingBox(true);
    try {
      await packingApi.deleteBox(activeSession.id);
      await loadOverview();
      setPopup({
        type: "SUCCESS",
        title: "Box Deleted",
        message: `Box ${activeSession.boxNumber} deleted successfully.`,
      });
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Delete Failed",
        message: error.response?.data?.error || "Unable to delete box",
      });
    } finally {
      setDeletingBox(false);
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
            <h1 className="text-2xl font-bold text-text-main">Packing Station</h1>
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
              <p className="text-xl font-bold text-text-main">
                {activeSession ? `${activeSession.packedCount}/${capacity}` : `0/${newBoxCapacity}`}
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
                  onMouseEnter={() => setHoveredSlot({ slotNo, partId: part || null })}
                  onMouseLeave={() => setHoveredSlot(null)}
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
          <div className="mt-2 text-xs text-text-muted min-h-[18px]">
            {hoveredSlot ? (
              <span>
                Slot {hoveredSlot.slotNo}:{" "}
                <span className="font-mono text-text-main">{hoveredSlot.partId || "EMPTY"}</span>
              </span>
            ) : (
              <span>Hover on slot to view packed part ID.</span>
            )}
          </div>
        </div>

        <div className="industrial-card p-6 space-y-4">
          <h2 className="font-bold text-text-main flex items-center gap-2">
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
            <div>
              <label className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">Box capacity</label>
              <input
                type="number"
                min={MIN_CAPACITY}
                max={MAX_CAPACITY}
                value={newBoxCapacity}
                onChange={(event) => {
                  const normalized = normalizeCapacity(event.target.value, newBoxCapacity);
                  setNewBoxCapacity(normalized);
                  localStorage.setItem(LOCAL_STORAGE_BOX_CAPACITY_KEY, String(normalized));
                }}
                className="mt-1 w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none font-mono"
                placeholder="65"
              />
              <p className="text-[11px] text-text-muted mt-1">
                Configure per box. Supported range {MIN_CAPACITY}-{MAX_CAPACITY} slots.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-primary text-bg-dark font-bold hover:brightness-110 disabled:opacity-60"
            >
              {loading ? "Starting..." : "Start Box"}
            </button>
          </form>

          {activeSession && (
            <form onSubmit={handleUpdateBox} className="space-y-2 border-t border-border/60 pt-3">
              <label className="text-xs text-text-muted uppercase font-bold">Update Active Box</label>
              <input
                value={editBoxNumber}
                onChange={(e) => setEditBoxNumber(e.target.value.toUpperCase())}
                className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none font-mono"
                placeholder="Correct box number"
              />
              <input
                type="number"
                min={MIN_CAPACITY}
                max={MAX_CAPACITY}
                value={editCapacity}
                onChange={(event) => setEditCapacity(normalizeCapacity(event.target.value, editCapacity))}
                className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none font-mono"
                placeholder="Correct capacity"
              />
              <p className="text-[11px] text-text-muted">
                Use this when wrong box number/capacity was entered. Capacity cannot be less than packed count.
              </p>
              <button
                type="submit"
                disabled={loading || updatingBox}
                className="w-full py-2.5 rounded-lg bg-warning text-black font-bold hover:brightness-110 disabled:opacity-60"
              >
                {updatingBox ? "Updating..." : "Update Active Box"}
              </button>
              <button
                type="button"
                onClick={handleDeleteBox}
                disabled={loading || updatingBox || deletingBox}
                className="w-full py-2.5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-60"
              >
                {deletingBox ? "Deleting..." : "Delete Active Box"}
              </button>
            </form>
          )}

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
          <h2 className="font-bold text-text-main mb-3 flex items-center gap-2">
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
          <h2 className="font-bold text-text-main mb-3">Recent Box Sessions</h2>
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
