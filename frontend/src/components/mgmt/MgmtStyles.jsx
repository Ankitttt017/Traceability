import React from "react";
import { MGMT_CSS } from "./mgmtTheme";

/** Injects the shared management CSS once per page (wrap the page in className="mg-root"). */
export default function MgmtStyles() {
  return <style>{MGMT_CSS}</style>;
}
