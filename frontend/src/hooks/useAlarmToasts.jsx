/**
 * useAlarmToasts - Global Socket.IO alarm listener.
 * Fires toast notifications for alarm:ng_rate, alarm:silent, alarm:plc_disconnect,
 * plc:write_failed, db:offline, db:reconnected, and scan_event.
 *
 * Mount this ONCE at the app root level (App.jsx) so toasts appear on every page.
 */
import { useEffect } from "react";
import { io } from "socket.io-client";
import toast from "react-hot-toast";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

// Simple ASCII icon strings for each event type.
const ICONS = {
  "alarm:ng_rate": "!",
  "alarm:silent": "!",
  "alarm:plc_disconnect": "!",
  "plc:write_failed": "x",
  "db:offline": "!",
  "db:reconnected": "+",
  scan_ok: "ok",
  scan_ng: "x",
};

function alarmToast({ icon, title, detail, type = "error" }) {
  const content = (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", opacity: 0.8 }}>
        {title}
      </span>
      {detail && (
        <span style={{ fontSize: 12, opacity: 0.9 }}>{detail}</span>
      )}
    </div>
  );

  if (type === "success") return toast.success(content, { icon, duration: 4000 });
  if (type === "warning") return toast(content, { icon, duration: 6000 });
  return toast.error(content, { icon, duration: 8000 });
}

export function useAlarmToasts() {
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
    });

    // Alarms
    socket.on("alarm:ng_rate", (data) => {
      alarmToast({
        icon: ICONS["alarm:ng_rate"],
        title: `NG Rate Alarm - ${data.machineName || `Machine ${data.machineId}`}`,
        detail: `NG Rate: ${data.ngRate || ""}  (${data.ngCount}/${data.totalCount} pcs)`,
        type: "error",
      });
    });

    socket.on("alarm:silent", (data) => {
      const last = data.lastScanTime
        ? `Last scan: ${new Date(data.lastScanTime).toLocaleTimeString()}`
        : "No recent scan found";
      alarmToast({
        icon: ICONS["alarm:silent"],
        title: `Silent Machine - ${data.machineName || `Machine ${data.machineId}`}`,
        detail: last,
        type: "error",
      });
    });

    socket.on("alarm:plc_disconnect", (data) => {
      alarmToast({
        icon: ICONS["alarm:plc_disconnect"],
        title: `PLC Disconnect - ${data.machineName || `Machine ${data.machineId}`}`,
        detail: data.ip ? `${data.ip}:${data.port}` : data.errorMessage || "",
        type: "error",
      });
    });

    // PLC Write Retry Failure
    socket.on("plc:write_failed", (data) => {
      alarmToast({
        icon: ICONS["plc:write_failed"],
        title: `PLC Write Failed - Machine ${data.machineId}`,
        detail: `Op: ${data.operation}  (3 retries exhausted)`,
        type: "error",
      });
    });

    // DB Buffer Events
    socket.on("db:offline", (data) => {
      alarmToast({
        icon: ICONS["db:offline"],
        title: "Database Offline",
        detail: `Buffering locally. ${data.count || ""} record(s) queued.`,
        type: "warning",
      });
    });

    socket.on("db:reconnected", (data) => {
      alarmToast({
        icon: ICONS["db:reconnected"],
        title: "Database Reconnected",
        detail: `Replayed ${data.replayed} record(s). Failed: ${data.failed}`,
        type: "success",
      });
    });

    // Scan Events (brief success/error flash)
    socket.on("scan_event", (data) => {
      if (!data) return;
      const decision = String(data.decision || "").trim().toUpperCase();
      const type = String(data.type || "").trim().toUpperCase();
      const reason = String(data.reason || "").trim().toUpperCase();
      const isOk = decision === "ALLOW" || type === "INFO" || type === "SUCCESS";
      if (isOk) return;

      if (reason.includes("PLC_TIMEOUT") || reason.includes("PLC_COMM") || reason === "RESET_REQUIRED_AFTER_PLC_COMM_ERROR") {
        toast(
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              PLC Communication Issue
            </span>
            <span style={{ fontSize: 12 }}>
              {data.partId || "Unknown"} - {data.machineName || `M${data.machineId}`}
            </span>
          </div>,
          { icon: "!", duration: 5000 }
        );
        return;
      }

      // Show NG/block scans only
      if (decision === "BLOCK" || type === "ERROR" || type === "WARNING") {
        toast.error(
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              NG Scan Detected
            </span>
            <span style={{ fontSize: 12 }}>
              {data.partId || "Unknown"} - {data.machineName || `M${data.machineId}`}
            </span>
          </div>,
          { icon: "x", duration: 5000 }
        );
      }
    });

    return () => socket.disconnect();
  }, []);
}
