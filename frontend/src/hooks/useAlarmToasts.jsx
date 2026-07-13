/**
 * useAlarmToasts - Global Socket.IO alarm listener.
 * Fires toast notifications for alarm:ng_rate, alarm:silent, alarm:plc_disconnect,
 * plc:write_failed, db:offline, db:reconnected, and scan_event.
 *
 * Mount this ONCE at the app root level (App.jsx) so toasts appear on every page.
 */
import { useEffect } from "react";
import { io } from "socket.io-client";
import { SOCKET_OPTIONS, SOCKET_URL } from "../constants/network";
import toast from "react-hot-toast";
import IndustrialToast from "../components/IndustrialToast";



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
  const toastType = type === "success" ? "SUCCESS" : type === "warning" ? "WARNING" : "ERROR";
  
  return toast.custom((t) => (
    <IndustrialToast 
      id={t.id}
      type={toastType}
      message={title}
      detail={detail}
      onClose={() => toast.dismiss(t.id)}
    />
  ), { 
    duration: type === "success" ? 4000 : type === "warning" ? 6000 : 8000 
  });
}

export function useAlarmToasts() {
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      ...SOCKET_OPTIONS,
      autoConnect: false,
      reconnectionAttempts: 5,
    });
    const connectTimer = setTimeout(() => {
      socket.connect();
    }, 0);

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
      
      if (isOk) {
        // Optional: Brief success toast for operator confirmation
        return;
      }

      const isPlcIssue = reason.includes("PLC_TIMEOUT") || reason.includes("PLC_COMM") || reason === "RESET_REQUIRED_AFTER_PLC_COMM_ERROR";
      
      if (isPlcIssue) {
        toast.custom((t) => (
          <IndustrialToast 
            id={t.id}
            type="PLC_ERROR"
            message="PLC Communication Issue"
            detail={`${data.partId || "Unknown"} - ${data.machineName || `M${data.machineId}`} (${reason})`}
            onClose={() => toast.dismiss(t.id)}
          />
        ), { duration: 6000 });
        return;
      }

      // Show NG/block scans only
      if (decision === "BLOCK" || type === "ERROR" || type === "WARNING") {
        toast.custom((t) => (
          <IndustrialToast 
            id={t.id}
            type={decision === "BLOCK" ? "BLOCKED" : "ERROR"}
            message={decision === "BLOCK" ? "Part Interlocked" : "NG Scan Detected"}
            detail={`${data.partId || "Unknown"} - ${data.machineName || `M${data.machineId}`} (${reason || "Quality Check Failed"})`}
            onClose={() => toast.dismiss(t.id)}
          />
        ), { duration: 8000 });
      }
    });

    return () => {
      clearTimeout(connectTimer);
      socket.removeAllListeners();
      if (socket.connected || socket.active) {
        socket.disconnect();
      }
    };
  }, []);
}



