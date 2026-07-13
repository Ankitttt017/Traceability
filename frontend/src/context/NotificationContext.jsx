import React, { createContext, useContext, useState, useEffect } from "react";
import { io } from "socket.io-client";
import { alarmApi } from "../api/services";
import { SOCKET_OPTIONS, SOCKET_URL } from "../constants/network";

const NotificationContext = createContext();


export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const addNotification = (notif) => {
    setNotifications((prev) => {
      // Check for duplicate alarm if it has an alarm_id
      if (notif.alarm_id && prev.some(p => p.alarm_id === notif.alarm_id)) {
        return prev;
      }
      return [
        {
          id: Date.now() + Math.random(),
          read: false,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          ...notif,
        },
        ...prev,
      ].slice(0, 50);
    });
  };

  const markAsRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  useEffect(() => {
    const fetchInitialAlarms = async () => {
      try {
        const alarms = await alarmApi.list();
        if (alarms && Array.isArray(alarms)) {
          const mapped = alarms.map(a => ({
            id: a.id,
            alarm_id: a.id, // for deduplication
            read: false,
            type: a.type === "PLC_DISCONNECT" ? "error" : "warning",
            message: `${String(a.type).replace(/_/g, ' ')}: ${a.machineName || `Machine ${a.machineId}`}`,
            detail: a.detail?.errorMessage || a.detail?.ngRate || "",
            time: new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }));
          setNotifications(mapped);
        }
      } catch (err) {
        console.error("Failed to fetch initial alarms:", err);
      }
    };

    fetchInitialAlarms();

    const socket = io(SOCKET_URL, {
      ...SOCKET_OPTIONS,
      autoConnect: false,
    });
    const connectTimer = setTimeout(() => {
      socket.connect();
    }, 0);

    socket.on("alarm:ng_rate", (data) => {
      addNotification({
        type: "warning",
        message: `NG Rate Alarm: ${data.machineName || `Machine ${data.machineId}`}`,
        detail: `NG Rate: ${data.ngRate} (${data.ngCount}/${data.totalCount})`,
      });
    });

    socket.on("alarm:silent", (data) => {
      addNotification({
        type: "warning",
        message: `Silent Machine: ${data.machineName || `Machine ${data.machineId}`}`,
        detail: "No activity detected in the last 10 minutes.",
      });
    });

    socket.on("alarm:plc_disconnect", (data) => {
      addNotification({
        type: "error",
        message: `PLC Disconnect: ${data.machineName || `Machine ${data.machineId}`}`,
        detail: data.ip ? `${data.ip}:${data.port}` : "Connection lost",
      });
    });

    socket.on("scan_event", (data) => {
      const status = String(data?.status || data?.plcStatus || data?.operationStatus || "").toUpperCase();
      const decision = String(data?.decision || data?.qrResult || "").toUpperCase();
      const reason = String(data?.reason || "").toUpperCase();
      if (data && (status.includes("NG") || decision === "BLOCK" || reason.includes("NG"))) {
        addNotification({
          type: "warning",
          message: `Station Alert: ${data.partId || "Unknown"}`,
          detail: `${data.machineName || data.stationNo || "Station"}${reason ? ` - ${reason.replace(/_/g, " ")}` : ""}`,
        });
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

  return (
    <NotificationContext.Provider
      value={{ notifications, addNotification, markAsRead, markAllRead }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
};
