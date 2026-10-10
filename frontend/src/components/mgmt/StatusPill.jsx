import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";
import { STATUS_COLOR, STATUS_BG, STATUS_LABEL } from "./mgmtTheme";

const ICON = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle, none: MinusCircle };

/** Status vs target — always icon + label, never colour alone. status: good | warn | bad | none */
export default function StatusPill({ status = "none", label, title, size = "md" }) {
  const Icon = ICON[status] || MinusCircle;
  const c = STATUS_COLOR[status] || STATUS_COLOR.none;
  return (
    <span
      className="mg-pill"
      title={title}
      style={{ color: c, background: STATUS_BG[status] || STATUS_BG.none, border: `1px solid ${c}33`, fontSize: size === "sm" ? 10.5 : 11.5 }}
    >
      <Icon size={size === "sm" ? 11 : 12} aria-hidden="true" />
      {label || STATUS_LABEL[status]}
    </span>
  );
}
