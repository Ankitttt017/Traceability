import { useEffect, useMemo, useState } from "react";
import { organizationApi } from "../api/services";

const defaultInputClass = "h-9 rounded-lg border border-border bg-bg-dark px-3 text-xs font-bold text-text-main outline-none focus:border-primary/60";
const defaultLabelClass = "mb-1.5 block text-[10px] font-black uppercase tracking-wider text-text-muted";

export default function PlantLineSelector({
  value = {},
  onChange,
  includeAll = false,
  compact = false,
  inputClassName = defaultInputClass,
  labelClassName = defaultLabelClass,
  plantLabel = "Plant",
  lineLabel = "Line",
  hideLabels = false,
  className = "",
  requirePlantForLine = false,
}) {
  const [organization, setOrganization] = useState({ plants: [], lines: [] });

  useEffect(() => {
    let mounted = true;
    organizationApi.context()
      .then((org) => {
        if (mounted) setOrganization({ plants: org?.plants || [], lines: org?.lines || [] });
      })
      .catch(() => {
        if (mounted) setOrganization({ plants: [], lines: [] });
      });
    return () => { mounted = false; };
  }, []);

  const plantId = value.plantId || "";
  const lineId = value.lineId || "";
  const scopedLines = useMemo(
    () => (organization.lines || []).filter((line) => !plantId ? !requirePlantForLine : String(line.plantId) === String(plantId)),
    [organization.lines, plantId, requirePlantForLine]
  );

  const emit = (next) => {
    const selectedLine = (organization.lines || []).find((line) => String(line.id) === String(next.lineId || ""));
    onChange?.({
      plantId: next.plantId || "",
      lineId: next.lineId || "",
      lineName: selectedLine?.lineName || "",
    });
  };

  return (
    <div className={className || `grid gap-3 ${compact ? "sm:grid-cols-2" : "md:grid-cols-2"}`}>
      <label>
        {!hideLabels && <span className={labelClassName}>{plantLabel}</span>}
        <select
          className={inputClassName}
          value={plantId}
          onChange={(e) => emit({ plantId: e.target.value, lineId: "" })}
        >
          <option value="">{includeAll ? "All Plants" : "Select Plant"}</option>
          {(organization.plants || []).map((plant) => (
            <option key={plant.id} value={plant.id}>{plant.plantName}</option>
          ))}
        </select>
      </label>
      <label>
        {!hideLabels && <span className={labelClassName}>{lineLabel}</span>}
        <select
          className={inputClassName}
          value={lineId}
          onChange={(e) => emit({ plantId, lineId: e.target.value })}
          disabled={(!includeAll && !plantId) || (requirePlantForLine && !plantId)}
        >
          <option value="">{requirePlantForLine && !plantId ? "Select Plant First" : (includeAll ? "All Lines" : "Select Line")}</option>
          {scopedLines.map((line) => (
            <option key={line.id} value={line.id}>{line.lineName}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
