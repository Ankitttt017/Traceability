/**
 * useAlarms — Returns the live alarm list for persistent banner display.
 * The actual Toast notifications are fired globally by useAlarmToasts in App.jsx.
 * This hook is for components that want to show a badge count or a persistent list.
 */
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL } from "../constants/network";


const MAX_ALARMS = 10;

export function useAlarms() {
  const [alarms, setAlarms] = useState([]);
  const idRef = useRef(0);

  useEffect(() => {
    const socket = io(SOCKET_URL, { path: "/socket.io/", transports: ["polling"], upgrade: false });

    const push = (type) => (data) => {
      const _id = ++idRef.current;
      setAlarms((prev) => [{ ...data, type, _id, receivedAt: new Date().toISOString() }, ...prev].slice(0, MAX_ALARMS));
    };

    socket.on("alarm:ng_rate",        push("alarm:ng_rate"));
    socket.on("alarm:silent",         push("alarm:silent"));
    socket.on("alarm:plc_disconnect", push("alarm:plc_disconnect"));

    return () => socket.disconnect();
  }, []);

  const dismiss = (id) => setAlarms((prev) => prev.filter((a) => a._id !== id));
  const clear   = ()   => setAlarms([]);

  return { alarms, dismiss, clear };
}



