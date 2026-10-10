import React from "react";
import { Inbox } from "lucide-react";

export default function EmptyState({ title = "No data for this period", hint, icon = Inbox, minHeight = 140 }) {
  const Icon = icon;
  return (
    <div className="mg-empty" style={{ minHeight }}>
      <Icon size={22} color="#94a3b8" aria-hidden="true" />
      <div style={{ fontWeight: 600, color: "#475569" }}>{title}</div>
      {hint && <div style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
