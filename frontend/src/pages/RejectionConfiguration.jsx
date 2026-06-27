import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Image, Plus, RefreshCw, Save, ShieldCheck, X,
  Layers, Eye, Grid3X3, Tag, List, Trash2, Pencil, CheckCircle, XCircle, Upload, FolderOpen
} from "lucide-react";
import { rejectionConfigApi } from "../api/services";
import ConfirmModal from "../components/ConfirmModal";

// ─── helpers ──────────────────────────────────────────────────────────────────
const splitLines = (value) =>
  String(value || "").split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);

const normalizePart = (value) =>
  String(value || "").trim().toUpperCase();

const categoryDisplayName = (category = {}) => {
  const name = String(category.name || "").trim();
  if (name) return name;
  const label = String(category.label || "").trim();
  const code = String(category.code || category.key || "").trim();
  return code && label.toUpperCase().startsWith(`${code.toUpperCase()} -`)
    ? label.slice(code.length + 2).trim()
    : label;
};

const buildZoneGrid = (zones = []) => {
  const rows = Array.isArray(zones) ? zones : [];
  if (!rows.length) return [];
  const columns = Math.ceil(Math.sqrt(rows.length));
  const rowCount = Math.ceil(rows.length / columns);
  const cellWidth = 100 / columns;
  const cellHeight = 100 / rowCount;
  return rows.map((zone, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...zone,
      xPercent: Number((column * cellWidth).toFixed(1)),
      yPercent: Number((row * cellHeight).toFixed(1)),
      widthPercent: Number(cellWidth.toFixed(1)),
      heightPercent: Number(cellHeight.toFixed(1)),
    };
  });
};

const getZoneGridShape = (zoneCount = 0) => {
  if (zoneCount <= 3) {
    return { columns: Math.max(1, zoneCount), rows: 1 };
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(zoneCount || 1)));
  const rows = Math.max(1, Math.ceil((zoneCount || 1) / columns));
  return { columns, rows };
};

const ZONE_LABEL_STYLES = [
  "border-cyan-500 bg-cyan-100 text-slate-950",
  "border-violet-500 bg-violet-100 text-slate-950",
  "border-emerald-500 bg-emerald-100 text-slate-950",
  "border-rose-500 bg-rose-100 text-slate-950",
  "border-sky-500 bg-sky-100 text-slate-950",
  "border-lime-600 bg-lime-100 text-slate-950",
];

const DUMMY_PART_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520">
  <rect width="900" height="520" fill="#e5e7eb"/>
  <g transform="translate(70 65)">
    <path d="M70 60 C130 20 250 15 350 35 C450 55 555 25 675 50 C720 60 760 100 770 155 L790 285 C798 345 745 390 680 400 L160 420 C85 420 38 365 45 300 L58 150 C62 110 38 85 70 60Z" fill="#374151" stroke="#0f172a" stroke-width="8"/>
    <path d="M210 135 C275 95 385 95 445 135 C505 175 500 285 435 330 C365 380 245 355 200 290 C165 238 160 168 210 135Z" fill="#111827" stroke="#030712" stroke-width="6" opacity=".9"/>
    <path d="M535 145 C600 105 690 130 720 195 C750 260 700 335 625 345 C555 355 500 305 492 240 C486 195 502 165 535 145Z" fill="#1f2937" stroke="#030712" stroke-width="6" opacity=".85"/>
    <g fill="#d1d5db" stroke="#111827" stroke-width="3">
      <circle cx="90" cy="85" r="13"/><circle cx="170" cy="55" r="12"/><circle cx="275" cy="45" r="12"/>
      <circle cx="405" cy="60" r="12"/><circle cx="535" cy="55" r="12"/><circle cx="675" cy="80" r="13"/>
      <circle cx="745" cy="170" r="12"/><circle cx="760" cy="305" r="12"/><circle cx="660" cy="375" r="13"/>
      <circle cx="500" cy="390" r="12"/><circle cx="330" cy="398" r="12"/><circle cx="165" cy="390" r="13"/>
      <circle cx="75" cy="310" r="12"/><circle cx="80" cy="180" r="12"/>
    </g>
  </g>
</svg>
`)}`;

const TABS = [
  { id: "parts",      icon: Layers,    label: "Part Master" },
  { id: "views",      icon: Eye,       label: "View Setup" },
  { id: "zones",      icon: Grid3X3,   label: "Zone Designer" },
  { id: "subzones",   icon: Grid3X3,   label: "Sub Zones" },
  { id: "assign",     icon: CheckCircle,label: "Assign Reasons" },
  { id: "categories", icon: Tag,       label: "Rejection Categories" },
  { id: "reasons",    icon: List,      label: "Rejection Reasons" },
];

// ─── modal ────────────────────────────────────────────────────────────────────
const Modal = ({ title, children, onClose }) => (
  <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
    <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b border-border bg-bg-dark/60 px-5 py-4">
        <h2 className="text-sm font-black uppercase tracking-wider text-text-main">{title}</h2>
        <button onClick={onClose} className="rounded-lg border border-border bg-bg-elevated p-2 text-text-muted hover:text-text-main">
          <X size={16} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

// ─── shared field components ──────────────────────────────────────────────────
const Field = ({ label, value, onChange, placeholder, type = "text" }) => (
  <label className="mt-3 block space-y-1">
    <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-sm font-bold text-text-main outline-none focus:border-primary"
    />
  </label>
);

const TextArea = ({ label, value, onChange, placeholder, rows = 4 }) => (
  <label className="mt-3 block space-y-1">
    <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">{label}</span>
    <textarea
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-sm font-bold text-text-main outline-none focus:border-primary"
    />
  </label>
);

const MultiLineField = ({ label, value, onChange, placeholder, rows = 5 }) => {
  const lineCount = Math.max(rows, String(value || placeholder || "").split(/\r?\n/).length);
  return (
    <label className="mt-3 block space-y-1">
      <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">{label}</span>
      <div className="flex overflow-hidden rounded-lg border border-border bg-bg-card focus-within:border-primary">
        <div className="select-none border-r border-border bg-bg-dark/60 px-2 py-2 text-right text-sm font-black leading-6 text-text-muted">
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <textarea
          rows={lineCount}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-[9rem] flex-1 resize-y bg-transparent px-3 py-2 text-sm font-bold leading-6 text-text-main outline-none"
        />
      </div>
    </label>
  );
};

const SelectField = ({ label, value, onChange, options = [] }) => (
  <label className="block space-y-1">
    <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">{label}</span>
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-sm font-bold text-text-main outline-none focus:border-primary"
    >
      <option value="">Select {label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
);

const NumberField = ({ label, value, onChange }) => (
  <Field label={label} type="number" value={value} onChange={(v) => onChange(Number(v))} />
);

const compressImageFile = async (file, { maxWidth = 1800, maxHeight = 1040, maxBytes = 5 * 1024 * 1024 } = {}) => {
  const image = await new Promise((resolve, reject) => {
    const element = new window.Image();
    const objectUrl = URL.createObjectURL(file);
    element.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(element);
    };
    element.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read selected image."));
    };
    element.src = objectUrl;
  });

  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (sourceWidth < 450 || sourceHeight < 260) {
    throw new Error(`Image is too small (${sourceWidth}×${sourceHeight}). Minimum size is 450×260.`);
  }

  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const preserveTransparency = ["image/png", "image/webp"].includes(file.type);
  const outputType = preserveTransparency ? "image/webp" : "image/jpeg";
  const qualities = preserveTransparency ? [0.88, 0.78, 0.68, 0.58] : [0.88, 0.8, 0.72, 0.64, 0.56];
  for (const quality of qualities) {
    const dataUrl = canvas.toDataURL(outputType, quality);
    const estimatedBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
    if (estimatedBytes <= maxBytes) {
      return { dataUrl, width, height, estimatedBytes };
    }
  }
  throw new Error("Image remains larger than 5 MB after compression. Please choose a smaller image.");
};

const ImageInputField = ({ label, value, onChange, inputId, onError }) => {
  const browseImage = async (file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      onError?.("Please choose a valid image file.");
      return;
    }
    try {
      const compressed = await compressImageFile(file);
      onChange(compressed.dataUrl);
    } catch (error) {
      onError?.(error?.message || "Unable to compress selected image.");
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">{label}</span>
        <span className="text-[9px] font-bold text-text-muted">Min 450×260 · Recommended 900×520 · Max 1800×1040 / 5 MB</span>
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-bg-dark/30 p-3 sm:grid-cols-[128px_1fr]">
        {value ? (
          <img src={value} alt="" className="h-24 w-32 rounded-lg border border-border bg-bg-elevated object-contain" />
        ) : (
          <div className="flex h-24 w-32 items-center justify-center rounded-lg border border-dashed border-border bg-bg-elevated px-2 text-center text-[10px] font-black uppercase tracking-wider text-text-muted">
            No Image
          </div>
        )}
        <div className="flex min-w-0 flex-col justify-center gap-2">
          <input
            value={value || ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder="/assets/part-top.png"
            className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-sm font-bold text-text-main outline-none focus:border-primary"
          />
          <div className="flex items-center justify-between gap-2">
            <input
              id={inputId}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => browseImage(event.target.files?.[0])}
            />
            <label
              htmlFor={inputId}
              className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-black uppercase text-text-main hover:border-primary hover:text-primary"
            >
              <FolderOpen size={14} /> Browse
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

const ActionButton = ({ label, onClick, primary = false, disabled = false, icon: Icon }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black uppercase tracking-wider disabled:opacity-50 ${
      primary ? "bg-primary text-white" : "border border-border bg-bg-elevated text-text-main"
    }`}
  >
    {Icon && <Icon size={13} />}
    {label}
  </button>
);

const IconButton = ({ onClick, icon: Icon, title, danger = false, disabled = false }) => (
  <button
    type="button"
    title={title}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.(event);
    }}
    disabled={disabled}
    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 ${
      danger
        ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
        : "border-border bg-bg-elevated text-text-main hover:border-primary hover:text-primary"
    }`}
  >
    <Icon size={14} />
  </button>
);

const StatusBadge = ({ active }) =>
  active ? (
    <span className="inline-flex items-center gap-1 rounded border border-green-600/30 bg-green-600/10 px-2 py-0.5 text-[10px] font-black uppercase text-green-500">
      <CheckCircle size={10} /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-black uppercase text-red-500">
      <XCircle size={10} /> Inactive
    </span>
  );

const EmptyState = ({ text }) => (
  <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-bg-elevated px-4 py-8 text-sm font-bold text-text-muted">
    <AlertTriangle size={16} />
    {text}
  </div>
);

const SectionHeader = ({ title, onAdd, addLabel = "Add" }) => (
  <div className="flex items-center justify-between border-b border-border bg-bg-dark/40 px-4 py-3">
    <h2 className="text-xs font-black uppercase tracking-wider text-text-main">{title}</h2>
    {onAdd && (
      <button onClick={onAdd} className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-xs font-black text-primary hover:bg-primary/20">
        <Plus size={13} /> {addLabel}
      </button>
    )}
  </div>
);

// ─── PART MASTER TAB ─────────────────────────────────────────────────────────
const PartMasterTab = ({ partOptions, partName, onSelectPart, onAddPart, onEditPart, onDeletePart }) => (
  <div className="industrial-card overflow-hidden p-0">
    <SectionHeader title="Part Master" onAdd={onAddPart} addLabel="Add Part" />
    <div className="overflow-x-auto p-4">
      <table className="w-full min-w-[640px] table-fixed text-sm">
        <colgroup>
          <col className="w-20" />
          <col />
          <col className="w-32" />
          <col className="w-44" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-[10px] font-black uppercase tracking-wider text-text-muted">
            <th className="pb-2 pr-4">#</th>
            <th className="pb-2 pr-4">Part Name</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {partOptions.length === 0 ? (
            <tr><td colSpan={4} className="pt-4"><EmptyState text="No parts configured. Add a part to get started." /></td></tr>
          ) : partOptions.map((part, i) => (
            <tr key={part} className={`border-b border-border/50 ${part === partName ? "bg-primary/5" : ""}`}>
              <td className="py-3 pr-4 text-text-muted font-bold">{String(i + 1).padStart(3, "0")}</td>
              <td className="truncate py-3 pr-4 font-black text-text-main" title={part}>{part}</td>
              <td className="py-3 pr-4"><StatusBadge active /></td>
              <td className="py-3">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => onSelectPart(part)}
                    className={`h-8 min-w-[76px] rounded-lg border px-3 text-[10px] font-black uppercase ${
                      part === partName ? "border-primary bg-primary text-white" : "border-border bg-bg-elevated text-text-main hover:border-primary hover:text-primary"
                    }`}
                  >
                    {part === partName ? "Selected" : "Select"}
                  </button>
                  <IconButton icon={Pencil} title="Edit part" onClick={() => onEditPart(part)} />
                  <IconButton icon={Trash2} title="Delete part" danger onClick={() => onDeletePart(part)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// ─── VIEW SETUP TAB ──────────────────────────────────────────────────────────
const ViewSetupTab = ({ views, partName, imageDrafts, setImageDrafts, onAddView, onSaveImage, onBrowseImage, onEditView, onDeleteView, saving }) => (
  <div className="industrial-card overflow-hidden p-0">
    <SectionHeader title={`View Setup — ${partName}`} onAdd={onAddView} addLabel="Add View" />
    <div className="p-4">
      {views.length === 0 ? (
        <EmptyState text="No views configured. Add Top / Bottom / Left / Right views." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {views.map((view) => (
            <div key={view.id} className="rounded-lg border border-border bg-bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-black text-text-main">{view.name}</span>
                <div className="flex items-center gap-1">
                  <span className="rounded border border-border px-2 py-0.5 text-[10px] font-black text-text-muted">{view.zones?.length || 0} zones</span>
                  <IconButton icon={Pencil} title="Edit view" onClick={() => onEditView(view)} />
                  <IconButton icon={Trash2} title="Delete view" danger onClick={() => onDeleteView(view)} />
                </div>
              </div>
              {imageDrafts[view.id] ? (
                <img
                  src={imageDrafts[view.id]}
                  alt={view.name}
                  className="mb-3 aspect-video w-full rounded border border-border bg-bg-elevated object-contain"
                />
              ) : (
                <div className="mb-3 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded border border-dashed border-border bg-bg-elevated text-xs font-black uppercase tracking-wider text-text-muted">
                  <Upload size={20} />
                  No Image
                </div>
              )}
              <div className="hidden">
                <input
                  value={imageDrafts[view.id] || ""}
                  onChange={(e) => setImageDrafts((prev) => ({ ...prev, [view.id]: e.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-bg-dark px-3 py-2 text-xs font-semibold text-text-main outline-none focus:border-primary"
                  placeholder="Paste image URL…"
                />
                <input
                  id={`view-image-${view.id}`}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => onBrowseImage(view.id, event.target.files?.[0])}
                />
                <label
                  htmlFor={`view-image-${view.id}`}
                  title="Browse image"
                  className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-black text-text-main hover:border-primary hover:text-primary"
                >
                  <FolderOpen size={13} />
                </label>
                <button
                  onClick={() => onSaveImage(view.id)}
                  disabled={saving}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  <Save size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

// ─── ZONE DESIGNER TAB ───────────────────────────────────────────────────────
const ZoneDesignerTab = ({
  views,
  selectedViewId,
  setSelectedViewId,
  selectedZoneId,
  setSelectedZoneId,
  onAddZones,
  onEditZone,
  onDeleteZone,
  onChangeLayout,
  onAutoDivide,
  onSaveLayout,
  saving,
  selectedView,
}) => {
  const zones = selectedView?.zones || [];
  const { columns, rows } = getZoneGridShape(zones.length);
  const [verticalDividers, setVerticalDividers] = useState([]);
  const [horizontalDividers, setHorizontalDividers] = useState([]);

  useEffect(() => {
    setVerticalDividers(Array.from(
      { length: Math.max(0, columns - 1) },
      (_, index) => Number(((index + 1) * 100 / columns).toFixed(1))
    ));
    setHorizontalDividers(Array.from(
      { length: Math.max(0, rows - 1) },
      (_, index) => Number(((index + 1) * 100 / rows).toFixed(1))
    ));
  }, [selectedViewId, columns, rows]);

  const startDividerDrag = (event, orientation, dividerIndex) => {
    event.preventDefault();
    event.stopPropagation();
    const container = event.currentTarget.closest("[data-zone-canvas]");
    if (!container) return;
    const move = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      if (orientation === "vertical") {
        const value = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        setVerticalDividers((current) => current.map((position, index) =>
          index === dividerIndex ? Math.max(1, Math.min(99, Number(value.toFixed(1)))) : position
        ));
      } else {
        const value = ((moveEvent.clientY - rect.top) / rect.height) * 100;
        setHorizontalDividers((current) => current.map((position, index) =>
          index === dividerIndex ? Math.max(1, Math.min(99, Number(value.toFixed(1)))) : position
        ));
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startZoneDrag = (event, zone) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedZoneId(zone.id);
    const container = event.currentTarget.closest("[data-zone-canvas]");
    if (!container) return;
    const offsetX = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const offsetY = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const move = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      const xPercent = ((moveEvent.clientX - rect.left - offsetX) / rect.width) * 100;
      const yPercent = ((moveEvent.clientY - rect.top - offsetY) / rect.height) * 100;
      const width = Number(zone.widthPercent || 10);
      const height = Number(zone.heightPercent || 10);
      onChangeLayout(zones.map((row) => Number(row.id) !== Number(zone.id) ? row : {
        ...row,
        xPercent: Math.max(0, Math.min(100 - width, Number(xPercent.toFixed(1)))),
        yPercent: Math.max(0, Math.min(100 - height, Number(yPercent.toFixed(1)))),
      }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startZoneResize = (event, zone) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedZoneId(zone.id);
    const container = event.currentTarget.closest("[data-zone-canvas]");
    if (!container) return;
    const move = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      const pointerX = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      const pointerY = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      onChangeLayout(zones.map((row) => Number(row.id) !== Number(zone.id) ? row : {
        ...row,
        widthPercent: Math.max(6, Math.min(100 - Number(zone.xPercent || 0), Number((pointerX - Number(zone.xPercent || 0)).toFixed(1)))),
        heightPercent: Math.max(6, Math.min(100 - Number(zone.yPercent || 0), Number((pointerY - Number(zone.yPercent || 0)).toFixed(1)))),
      }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
  <div className="industrial-card overflow-hidden p-0">
    <SectionHeader title="Zone Designer" />
    <div className="grid lg:grid-cols-[240px_1fr]">
      {/* View list sidebar */}
      <div className="border-b border-border bg-bg-dark/30 p-3 lg:border-b-0 lg:border-r">
        <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Select View</p>
        <div className="space-y-1">
          {views.length === 0 ? (
            <p className="text-xs font-bold text-text-muted">No views yet.</p>
          ) : views.map((view) => (
            <button
              key={view.id}
              onClick={() => setSelectedViewId(view.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold transition-colors ${
                Number(selectedViewId) === Number(view.id)
                  ? "bg-primary text-white"
                  : "text-text-main hover:bg-bg-elevated"
              }`}
            >
              <span>{view.name}</span>
              <span className={`text-[10px] font-black ${Number(selectedViewId) === Number(view.id) ? "text-white/70" : "text-text-muted"}`}>
                {view.zones?.length || 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Zone details */}
      <div className="p-4">
        {!selectedView ? (
          <EmptyState text="Select a view to manage its zones." />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-black text-text-main">{selectedView.name} — Zones</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={onSaveLayout}
                  disabled={saving || !zones.length}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-white disabled:opacity-40"
                >
                  <Save size={13} /> Save Layout
                </button>
                <button
                  onClick={onAutoDivide}
                  disabled={saving || !(selectedView.zones || []).length}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-xs font-black text-text-main disabled:opacity-40"
                >
                  <Grid3X3 size={13} /> Auto Divide
                </button>
                <button
                  onClick={onAddZones}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-xs font-black text-primary"
                >
                  <Plus size={13} /> Add Zone
                </button>
              </div>
            </div>

            {/* Image with zone overlays */}
            <div data-zone-canvas className="relative mb-4 aspect-[900/520] w-full overflow-hidden rounded-lg border border-border bg-bg-elevated">
              {selectedView.imageUrl ? (
                <img src={selectedView.imageUrl} alt={selectedView.name} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs font-black uppercase text-text-muted">No Image — Set in View Setup</div>
              )}
              {verticalDividers.map((position, index) => (
                <button
                  key={`vertical-${index}`}
                  type="button"
                  title="Drag vertical divider"
                  onPointerDown={(event) => startDividerDrag(event, "vertical", index)}
                  className="absolute inset-y-0 z-30 w-6 -translate-x-1/2 cursor-col-resize touch-none"
                  style={{ left: `${position}%` }}
                >
                  <span className="absolute inset-y-0 left-1/2 border-l-4 border-dotted border-red-600" />
                </button>
              ))}
              {horizontalDividers.map((position, index) => (
                <button
                  key={`horizontal-${index}`}
                  type="button"
                  title="Drag horizontal divider"
                  onPointerDown={(event) => startDividerDrag(event, "horizontal", index)}
                  className="absolute inset-x-0 z-30 h-6 -translate-y-1/2 cursor-row-resize touch-none"
                  style={{ top: `${position}%` }}
                >
                  <span className="absolute inset-x-0 top-1/2 border-t-4 border-dotted border-red-600" />
                </button>
              ))}
              {zones.map((zone, zoneIndex) => (
                <button
                  key={zone.id}
                  type="button"
                  onPointerDown={(event) => startZoneDrag(event, zone)}
                  onClick={() => setSelectedZoneId(zone.id)}
                  style={{
                    position: "absolute",
                    left: `${Math.max(0, Math.min(100, Number(zone.xPercent ?? 0)))}%`,
                    top: `${Math.max(0, Math.min(100, Number(zone.yPercent ?? 0)))}%`,
                    width: `${Math.max(0, Math.min(100 - Number(zone.xPercent ?? 0), Number(zone.widthPercent ?? 12)))}%`,
                    height: `${Math.max(0, Math.min(100 - Number(zone.yPercent ?? 0), Number(zone.heightPercent ?? 12)))}%`,
                    boxSizing: "border-box",
                  }}
                  className={`flex overflow-hidden cursor-move touch-none items-center justify-center text-lg font-black ${
                    Number(selectedZoneId) === Number(zone.id)
                      ? "z-10 bg-green-500/25 text-green-950"
                      : "text-primary"
                  }`}
                >
                  <span className={`flex h-10 min-w-10 items-center justify-center rounded-md border-2 px-2 text-base font-black shadow-md ${
                    Number(selectedZoneId) === Number(zone.id)
                      ? "border-green-700 bg-green-500 text-white"
                      : ZONE_LABEL_STYLES[zoneIndex % ZONE_LABEL_STYLES.length]
                  }`}>
                    {zone.code || zone.name}
                  </span>
                  <span
                    title="Drag to resize zone"
                    onPointerDown={(event) => startZoneResize(event, zone)}
                    className={`absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize border-l-2 border-t-2 ${
                      Number(selectedZoneId) === Number(zone.id)
                        ? "border-white bg-green-600"
                        : "border-primary bg-white"
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Zone table */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] font-black uppercase tracking-wider text-text-muted">
                  <th className="pb-2 pr-4">Zone</th>
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Position</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {(selectedView.zones || []).map((zone) => (
                  <tr key={zone.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <span className="inline-block rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-black text-primary">{zone.code}</span>
                    </td>
                    <td className="py-2 pr-4 font-bold text-text-main">{zone.name}</td>
                    <td className="py-2 pr-4 text-xs text-text-muted font-bold">
                      x: {zone.xPercent}% y: {zone.yPercent}%
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <IconButton icon={Pencil} title="Edit zone" onClick={() => onEditZone(zone)} />
                        <IconButton icon={Trash2} title="Delete zone" danger onClick={() => onDeleteZone(zone)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  </div>
  );
};

const SubZoneDesignerTab = ({
  views,
  selectedViewId,
  setSelectedViewId,
  selectedZoneId,
  setSelectedZoneId,
  selectedSubZoneId,
  setSelectedSubZoneId,
  selectedView,
  selectedZone,
  onAddSubZones,
  onEditSubZone,
  onDeleteSubZone,
  onChangeSubZoneLayout,
  onAutoDivideSubZones,
  onSaveSubZoneLayout,
  saving,
}) => {
  const zones = selectedView?.zones || [];
  const subZones = selectedZone?.subZones || [];
  const zoneBounds = {
    x: Number(selectedZone?.xPercent || 0),
    y: Number(selectedZone?.yPercent || 0),
    w: Math.max(1, Number(selectedZone?.widthPercent || 10)),
    h: Math.max(1, Number(selectedZone?.heightPercent || 10)),
  };

  const startSubZoneDrag = (event, subZone) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedSubZoneId(subZone.id);
    const container = event.currentTarget.closest("[data-sub-zone-canvas]");
    if (!container) return;
    const offsetX = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const offsetY = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const move = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      const canvasX = ((moveEvent.clientX - rect.left - offsetX) / rect.width) * 100;
      const canvasY = ((moveEvent.clientY - rect.top - offsetY) / rect.height) * 100;
      const xPercent = ((canvasX - zoneBounds.x) / zoneBounds.w) * 100;
      const yPercent = ((canvasY - zoneBounds.y) / zoneBounds.h) * 100;
      const width = Number(subZone.widthPercent || 10);
      const height = Number(subZone.heightPercent || 10);
      onChangeSubZoneLayout(subZones.map((row) => Number(row.id) !== Number(subZone.id) ? row : {
        ...row,
        xPercent: Math.max(0, Math.min(100 - width, Number(xPercent.toFixed(1)))),
        yPercent: Math.max(0, Math.min(100 - height, Number(yPercent.toFixed(1)))),
      }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startSubZoneResize = (event, subZone) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedSubZoneId(subZone.id);
    const container = event.currentTarget.closest("[data-sub-zone-canvas]");
    if (!container) return;
    const move = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      const canvasPointerX = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      const canvasPointerY = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      const pointerX = ((canvasPointerX - zoneBounds.x) / zoneBounds.w) * 100;
      const pointerY = ((canvasPointerY - zoneBounds.y) / zoneBounds.h) * 100;
      onChangeSubZoneLayout(subZones.map((row) => Number(row.id) !== Number(subZone.id) ? row : {
        ...row,
        widthPercent: Math.max(5, Math.min(100 - Number(subZone.xPercent || 0), Number((pointerX - Number(subZone.xPercent || 0)).toFixed(1)))),
        heightPercent: Math.max(5, Math.min(100 - Number(subZone.yPercent || 0), Number((pointerY - Number(subZone.yPercent || 0)).toFixed(1)))),
      }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div className="industrial-card overflow-hidden p-0">
      <SectionHeader title="Sub Zone Designer" />
      <div className="grid lg:grid-cols-[260px_1fr]">
        <div className="border-b border-border bg-bg-dark/30 p-3 lg:border-b-0 lg:border-r">
          <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-text-muted">View</p>
          <div className="mb-4 space-y-1">
            {views.map((view) => (
              <button key={view.id} onClick={() => setSelectedViewId(view.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold ${Number(selectedViewId) === Number(view.id) ? "bg-primary text-white" : "text-text-main hover:bg-bg-elevated"}`}>
                <span>{view.name}</span>
                <span className="text-[10px] font-black">{view.zones?.length || 0}</span>
              </button>
            ))}
          </div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Zone</p>
          <div className="space-y-1">
            {zones.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs font-bold text-text-muted">Add zones first.</p>
            ) : zones.map((zone) => (
              <button key={zone.id} onClick={() => setSelectedZoneId(zone.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold ${Number(selectedZoneId) === Number(zone.id) ? "bg-primary text-white" : "text-text-main hover:bg-bg-elevated"}`}>
                <span>{zone.name || zone.code}</span>
                <span className="text-[10px] font-black">{zone.subZones?.length || 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          {!selectedView || !selectedZone ? (
            <EmptyState text="Select a view and zone to create sub-zones." />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black text-text-main">{selectedView.name} / {selectedZone.name || selectedZone.code}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={onSaveSubZoneLayout} disabled={saving || !subZones.length} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-white disabled:opacity-40">
                    <Save size={13} /> Save Layout
                  </button>
                  <button onClick={onAutoDivideSubZones} disabled={saving || !subZones.length} className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-xs font-black text-text-main disabled:opacity-40">
                    <Grid3X3 size={13} /> Auto Divide
                  </button>
                  <button onClick={onAddSubZones} className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-xs font-black text-primary">
                    <Plus size={13} /> Add Sub Zone
                  </button>
                </div>
              </div>

              <div data-sub-zone-canvas className="relative mb-4 aspect-[900/520] w-full overflow-hidden rounded-lg border border-border bg-bg-elevated">
                {selectedView.imageUrl ? (
                  <img src={selectedView.imageUrl} alt={selectedView.name} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-black uppercase text-text-muted">No Image</div>
                )}
                <div className="absolute border-2 border-yellow-400 bg-yellow-300/10" style={{ left: `${zoneBounds.x}%`, top: `${zoneBounds.y}%`, width: `${zoneBounds.w}%`, height: `${zoneBounds.h}%` }} />
                {subZones.map((subZone, index) => (
                  <button
                    key={subZone.id}
                    type="button"
                    onPointerDown={(event) => startSubZoneDrag(event, subZone)}
                    onClick={() => setSelectedSubZoneId(subZone.id)}
                    className={`absolute flex cursor-move touch-none items-center justify-center text-xs font-black ${Number(selectedSubZoneId) === Number(subZone.id) ? "z-20 bg-cyan-500/25" : "z-10 bg-blue-500/10"}`}
                    style={{
                      left: `${zoneBounds.x + (zoneBounds.w * Number(subZone.xPercent || 0) / 100)}%`,
                      top: `${zoneBounds.y + (zoneBounds.h * Number(subZone.yPercent || 0) / 100)}%`,
                      width: `${zoneBounds.w * Number(subZone.widthPercent || 10) / 100}%`,
                      height: `${zoneBounds.h * Number(subZone.heightPercent || 10) / 100}%`,
                    }}
                  >
                    <span className={`rounded border-2 px-2 py-1 shadow ${Number(selectedSubZoneId) === Number(subZone.id) ? "border-cyan-700 bg-cyan-500 text-white" : ZONE_LABEL_STYLES[index % ZONE_LABEL_STYLES.length]}`}>
                      {subZone.code || subZone.name}
                    </span>
                    <span title="Resize sub-zone" onPointerDown={(event) => startSubZoneResize(event, subZone)} className="absolute bottom-1 right-1 h-3 w-3 cursor-nwse-resize border-l-2 border-t-2 border-white bg-cyan-600" />
                  </button>
                ))}
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] font-black uppercase tracking-wider text-text-muted">
                    <th className="pb-2 pr-4">Sub Zone</th>
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Area</th>
                    <th className="pb-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {subZones.length === 0 ? (
                    <tr><td colSpan={4} className="pt-4"><EmptyState text="No sub-zones. Add small defect areas inside this zone." /></td></tr>
                  ) : subZones.map((subZone) => (
                    <tr key={subZone.id} className="border-b border-border/50">
                      <td className="py-2 pr-4"><span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-black text-primary">{subZone.code}</span></td>
                      <td className="py-2 pr-4 font-bold text-text-main">{subZone.name}</td>
                      <td className="py-2 pr-4 text-xs font-bold text-text-muted">x: {subZone.xPercent}% y: {subZone.yPercent}% w: {subZone.widthPercent}% h: {subZone.heightPercent}%</td>
                      <td className="py-2"><div className="flex gap-1"><IconButton icon={Pencil} title="Edit sub-zone" onClick={() => onEditSubZone(subZone)} /><IconButton icon={Trash2} title="Delete sub-zone" danger onClick={() => onDeleteSubZone(subZone)} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── REJECTION CATEGORY TAB ──────────────────────────────────────────────────
const CategoryTab = ({ categories, selectedCategoryId, setSelectedCategoryId, onAddCategory, onEditCategory, onDeleteCategory }) => (
  <div className="industrial-card overflow-hidden p-0">
    <SectionHeader title="Rejection Category Master" onAdd={onAddCategory} addLabel="Add Category" />
    <div className="p-4">
      {categories.length === 0 ? (
        <EmptyState text="No categories yet. Add a category to begin." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] font-black uppercase tracking-wider text-text-muted">
              <th className="pb-2 pr-4">#</th>
              <th className="pb-2 pr-4">Category Name</th>
              <th className="pb-2 pr-4">Reasons</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat, i) => (
              <tr
                key={cat.id}
                className={`border-b border-border/50 cursor-pointer transition-colors ${
                  Number(selectedCategoryId) === Number(cat.id) ? "bg-primary/5" : "hover:bg-bg-elevated"
                }`}
                onClick={() => setSelectedCategoryId(cat.id)}
              >
                <td className="py-3 pr-4 font-bold text-text-muted">{String(i + 1).padStart(2, "0")}</td>
                <td className="py-3 pr-4 font-black text-text-main">{cat.name}</td>
                <td className="py-3 pr-4">
                  <span className="rounded border border-border bg-bg-elevated px-2 py-0.5 text-[10px] font-black text-text-muted">
                    {cat.reasons?.length || 0} reasons
                  </span>
                </td>
                <td className="py-3 pr-4"><StatusBadge active /></td>
                <td className="py-3">
                  <div className="flex gap-1">
                    <IconButton icon={Pencil} title="Edit category" onClick={() => onEditCategory(cat)} />
                    <IconButton icon={Trash2} title="Delete category" danger onClick={() => onDeleteCategory(cat)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div>
);

// ─── REJECTION REASON TAB ─────────────────────────────────────────────────────
const ReasonTab = ({ categories, selectedCategoryId, setSelectedCategoryId, selectedReasonIds, toggleReason, onAddReasons, onApplyAll, onEditReason, onDeleteReason, saving }) => {
  const selectedCategory = categories.find((c) => Number(c.id) === Number(selectedCategoryId));
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Category picker */}
      <div className="industrial-card overflow-hidden p-0">
        <SectionHeader title="Categories" />
        <div className="p-3 space-y-1">
          {categories.length === 0 ? (
            <p className="text-xs font-bold text-text-muted p-2">No categories yet.</p>
          ) : categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-bold transition-colors ${
                Number(selectedCategoryId) === Number(cat.id)
                  ? "bg-primary text-white"
                  : "text-text-main hover:bg-bg-elevated"
              }`}
            >
              <span>{categoryDisplayName(cat)}</span>
              <span className={`rounded px-1.5 text-[10px] font-black ${
                Number(selectedCategoryId) === Number(cat.id) ? "bg-white/20 text-white" : "text-text-muted"
              }`}>
                {cat.reasons?.length || 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Reasons table */}
      <div className="industrial-card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border bg-bg-dark/40 px-4 py-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-text-main">
            Rejection Reasons {selectedCategory ? `— ${categoryDisplayName(selectedCategory)}` : ""}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onApplyAll}
              disabled={saving || !selectedCategoryId || selectedReasonIds.length === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-xs font-black text-text-main disabled:opacity-40"
            >
              <Save size={12} /> Apply to All Zones
            </button>
            <button
              onClick={onAddReasons}
              disabled={!selectedCategoryId}
              className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-xs font-black text-primary disabled:opacity-40"
            >
              <Plus size={13} /> Add Reason
            </button>
          </div>
        </div>
        <div className="p-4">
          {!selectedCategory ? (
            <EmptyState text="Select a category to view and manage its reasons." />
          ) : (selectedCategory.reasons || []).length === 0 ? (
            <EmptyState text="No reasons in this category. Add some." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] font-black uppercase tracking-wider text-text-muted">
                  <th className="pb-2 pr-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedReasonIds.length === (selectedCategory.reasons || []).length && selectedCategory.reasons.length > 0}
                      onChange={() => {}}
                      className="accent-primary"
                    />
                  </th>
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Reason Name</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {(selectedCategory.reasons || []).map((reason, i) => (
                  <tr key={reason.id} className="border-b border-border/50 hover:bg-bg-elevated/50">
                    <td className="py-3 pr-3">
                      <input
                        type="checkbox"
                        checked={selectedReasonIds.includes(Number(reason.id))}
                        onChange={() => toggleReason(reason.id)}
                        className="accent-primary"
                      />
                    </td>
                    <td className="py-3 pr-4 font-bold text-text-muted">{String(i + 1).padStart(2, "0")}</td>
                    <td className="py-3 pr-4 font-black text-text-main">{reason.name}</td>
                    <td className="py-3 pr-4"><StatusBadge active /></td>
                    <td className="py-3">
                      <div className="flex gap-1">
                        <IconButton icon={Pencil} title="Edit reason" onClick={() => onEditReason(reason)} />
                        <IconButton icon={Trash2} title="Delete reason" danger onClick={() => onDeleteReason(reason)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const AssignmentTab = ({
  categories,
  views,
  selectedCategoryId,
  setSelectedCategoryId,
  selectedViewId,
  setSelectedViewId,
  selectedZoneId,
  setSelectedZoneId,
  selectedSubZoneId,
  setSelectedSubZoneId,
  selectedCategory,
  selectedView,
  selectedZone,
  selectedSubZone,
  selectedReasonIds,
  toggleReason,
  onSaveZoneReasons,
  onSaveZonePosition,
  updateZoneDraft,
  onDragZone,
  onChangeLayout,
  onSaveLayout,
  onAutoDivide,
  saving,
}) => {
  const assignmentZones = selectedView?.zones || [];
  const assignmentShape = getZoneGridShape(assignmentZones.length);
  const [assignmentVerticalBounds, setAssignmentVerticalBounds] = useState([]);
  const [assignmentHorizontalBounds, setAssignmentHorizontalBounds] = useState([]);

  useEffect(() => {
    setAssignmentVerticalBounds(Array.from(
      { length: Math.max(0, assignmentShape.columns - 1) },
      (_, index) => Number(((index + 1) * 100 / assignmentShape.columns).toFixed(1))
    ));
    setAssignmentHorizontalBounds(Array.from(
      { length: Math.max(0, assignmentShape.rows - 1) },
      (_, index) => Number(((index + 1) * 100 / assignmentShape.rows).toFixed(1))
    ));
  }, [selectedViewId, assignmentShape.columns, assignmentShape.rows]);

  const startDividerDrag = (event, orientation, dividerIndex) => {
    event.preventDefault();
    event.stopPropagation();
    const container = event.currentTarget.closest("[data-assign-zone-canvas]");
    if (!container) return;
    const move = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      if (orientation === "vertical") {
        const value = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        setAssignmentVerticalBounds((current) => current.map((position, index) =>
          index === dividerIndex ? Math.max(1, Math.min(99, Number(value.toFixed(1)))) : position
        ));
      } else {
        const value = ((moveEvent.clientY - rect.top) / rect.height) * 100;
        setAssignmentHorizontalBounds((current) => current.map((position, index) =>
          index === dividerIndex ? Math.max(1, Math.min(99, Number(value.toFixed(1)))) : position
        ));
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const startZoneDrag = (event, zone) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedZoneId(zone.id);
    const container = event.currentTarget.closest("[data-assign-zone-canvas]");
    if (!container) return;
    const offsetX = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const offsetY = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const move = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      const xPercent = ((moveEvent.clientX - rect.left - offsetX) / rect.width) * 100;
      const yPercent = ((moveEvent.clientY - rect.top - offsetY) / rect.height) * 100;
      const width = Number(zone.widthPercent || 10);
      const height = Number(zone.heightPercent || 10);
      onDragZone(zone.id, {
        xPercent: Math.max(0, Math.min(100 - width, Number(xPercent.toFixed(1)))),
        yPercent: Math.max(0, Math.min(100 - height, Number(yPercent.toFixed(1)))),
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startZoneResize = (event, zone) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedZoneId(zone.id);
    const container = event.currentTarget.closest("[data-assign-zone-canvas]");
    if (!container) return;
    const move = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      const pointerX = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      const pointerY = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      onDragZone(zone.id, {
        widthPercent: Math.max(6, Math.min(100 - Number(zone.xPercent || 0), Number((pointerX - Number(zone.xPercent || 0)).toFixed(1)))),
        heightPercent: Math.max(6, Math.min(100 - Number(zone.yPercent || 0), Number((pointerY - Number(zone.yPercent || 0)).toFixed(1)))),
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
  <div className="industrial-card overflow-hidden p-0">
    <SectionHeader title="Category + View + Zone Wise Rejection Assignment" />
    <div className="grid gap-4 p-4 xl:grid-cols-[360px_1fr]">
      <div className="space-y-3">
        <SelectField label="Category" value={selectedCategoryId} onChange={setSelectedCategoryId} options={categories.map((row) => ({ value: row.id, label: categoryDisplayName(row) }))} />
        <SelectField label="View" value={selectedViewId} onChange={setSelectedViewId} options={views.map((row) => ({ value: row.id, label: row.name }))} />
        <SelectField label="Zone" value={selectedZoneId} onChange={setSelectedZoneId} options={(selectedView?.zones || []).map((row) => ({ value: row.id, label: row.name || row.code }))} />
        <SelectField label="Sub Zone" value={selectedSubZoneId} onChange={setSelectedSubZoneId} options={(selectedZone?.subZones || []).map((row) => ({ value: row.id, label: row.name || row.code }))} />

        <div className="rounded-lg border border-border bg-bg-elevated p-3">
          <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-text-muted">Allowed Reasons</p>
          {!selectedCategory ? (
            <p className="text-xs font-bold text-text-muted">Select category first.</p>
          ) : (
            <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
              {(selectedCategory.reasons || []).map((reason) => (
                <label key={reason.id} className="flex items-center gap-2 rounded border border-border bg-bg-card px-2 py-2 text-xs font-bold text-text-main">
                  <input type="checkbox" checked={selectedReasonIds.includes(Number(reason.id))} onChange={() => toggleReason(reason.id)} className="accent-primary" />
                  {reason.name}
                </label>
              ))}
            </div>
          )}
          <button onClick={onSaveZoneReasons} disabled={saving || !selectedCategoryId || !selectedViewId || !selectedZoneId} className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-xs font-black uppercase text-white disabled:opacity-50">
            Save For {selectedSubZone ? "Selected Sub Zone" : "Selected Zone"}
          </button>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div data-assign-zone-canvas className="relative aspect-[900/520] w-full self-start overflow-hidden rounded-xl border border-border bg-bg-elevated">
          {selectedView?.imageUrl ? (
            <img src={selectedView.imageUrl} alt={selectedView.name} className="absolute inset-0 h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-black uppercase tracking-wider text-text-muted">Add image URL in View Setup</div>
          )}
          {assignmentVerticalBounds.map((position, index) => (
            <button
              key={`assign-v-${index}`}
              type="button"
              title="Drag vertical divider"
              onPointerDown={(event) => startDividerDrag(event, "vertical", index)}
              className="absolute inset-y-0 z-30 w-6 -translate-x-1/2 cursor-col-resize touch-none"
              style={{ left: `${position}%` }}
            >
              <span className="absolute inset-y-0 left-1/2 border-l-4 border-dotted border-red-600" />
            </button>
          ))}
          {assignmentHorizontalBounds.map((position, index) => (
            <button
              key={`assign-h-${index}`}
              type="button"
              title="Drag horizontal divider"
              onPointerDown={(event) => startDividerDrag(event, "horizontal", index)}
              className="absolute inset-x-0 z-30 h-6 -translate-y-1/2 cursor-row-resize touch-none"
              style={{ top: `${position}%` }}
            >
              <span className="absolute inset-x-0 top-1/2 border-t-4 border-dotted border-red-600" />
            </button>
          ))}
          {assignmentZones.map((zone, zoneIndex) => (
            <button
              key={zone.id}
              type="button"
              onPointerDown={(event) => startZoneDrag(event, zone)}
              onClick={() => setSelectedZoneId(zone.id)}
              className={`absolute flex overflow-hidden cursor-move touch-none items-center justify-center text-lg font-black ${
                Number(selectedZoneId) === Number(zone.id)
                  ? "z-10 bg-green-500/25 text-green-950"
                  : "text-primary"
              }`}
              style={{
                left: `${Math.max(0, Math.min(100, Number(zone.xPercent ?? 0)))}%`,
                top: `${Math.max(0, Math.min(100, Number(zone.yPercent ?? 0)))}%`,
                width: `${Math.max(0, Math.min(100 - Number(zone.xPercent ?? 0), Number(zone.widthPercent ?? 10)))}%`,
                height: `${Math.max(0, Math.min(100 - Number(zone.yPercent ?? 0), Number(zone.heightPercent ?? 10)))}%`,
                boxSizing: "border-box",
              }}
            >
              <span className={`flex h-10 min-w-10 items-center justify-center rounded-md border-2 px-2 text-base font-black shadow-md ${
                Number(selectedZoneId) === Number(zone.id)
                  ? "border-green-700 bg-green-500 text-white"
                  : ZONE_LABEL_STYLES[zoneIndex % ZONE_LABEL_STYLES.length]
              }`}>
                {zone.code || zone.name}
              </span>
              <span
                title="Drag to resize zone"
                onPointerDown={(event) => startZoneResize(event, zone)}
                className={`absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize border-l-2 border-t-2 ${
                  Number(selectedZoneId) === Number(zone.id)
                    ? "border-white bg-green-600"
                    : "border-primary bg-white"
                }`}
              />
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-bg-card p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-wider text-text-main">Zone Position</p>
            <button
              type="button"
              onClick={onAutoDivide}
              disabled={saving || !assignmentZones.length}
              className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-2.5 py-1.5 text-[10px] font-black uppercase text-primary disabled:opacity-40"
            >
              <Grid3X3 size={12} /> Auto Adjust
            </button>
          </div>
          {!selectedZone ? (
            <p className="text-sm font-bold text-text-muted">Select zone to edit A/B/C position.</p>
          ) : (
            <div className="space-y-2">
              <Field label="Zone Name" value={selectedZone.name || ""} onChange={(v) => updateZoneDraft("name", v)} />
              <NumberField label="X %" value={selectedZone.xPercent || 10} onChange={(v) => updateZoneDraft("xPercent", v)} />
              <NumberField label="Y %" value={selectedZone.yPercent || 10} onChange={(v) => updateZoneDraft("yPercent", v)} />
              <NumberField label="Width %" value={selectedZone.widthPercent || 10} onChange={(v) => updateZoneDraft("widthPercent", v)} />
              <NumberField label="Height %" value={selectedZone.heightPercent || 10} onChange={(v) => updateZoneDraft("heightPercent", v)} />
              <button onClick={onSaveZonePosition} disabled={saving} className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-black uppercase text-white disabled:opacity-50">
                Save Zone Position
              </button>
              <button onClick={onSaveLayout} disabled={saving} className="w-full rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-black uppercase text-primary disabled:opacity-50">
                Save Full Layout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  );
};

const RejectionConfiguration = () => {
  const [activeTab, setActiveTab] = useState("parts");
  const [partName, setPartName] = useState("");
  const [partOptions, setPartOptions] = useState([]);
  const [config, setConfig] = useState(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedViewId, setSelectedViewId] = useState("");
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [selectedSubZoneId, setSelectedSubZoneId] = useState("");
  const [selectedReasonIds, setSelectedReasonIds] = useState([]);
  const [imageDrafts, setImageDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "info" });
  const [modal, setModal] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [newPartName, setNewPartName] = useState("");
  const [categoryForm, setCategoryForm] = useState({ name: "", reasons: "" });
  const [reasonText, setReasonText] = useState("");
  const [viewForm, setViewForm] = useState({ name: "", imageUrl: "", zones: "A\nB\nC\nD" });
  const [zoneText, setZoneText] = useState("");
  const [subZoneText, setSubZoneText] = useState("");

  const categories = Array.isArray(config?.categories) ? config.categories : [];
  const views = Array.isArray(config?.views) ? config.views : [];

  const selectedCategory = useMemo(
    () => categories.find((r) => Number(r.id) === Number(selectedCategoryId)) || null,
    [categories, selectedCategoryId]
  );
  const selectedView = useMemo(
    () => views.find((r) => Number(r.id) === Number(selectedViewId)) || null,
    [views, selectedViewId]
  );
  const selectedZone = useMemo(
    () => (selectedView?.zones || []).find((r) => Number(r.id) === Number(selectedZoneId)) || null,
    [selectedView, selectedZoneId]
  );
  const selectedSubZone = useMemo(
    () => (selectedZone?.subZones || []).find((r) => Number(r.id) === Number(selectedSubZoneId)) || null,
    [selectedZone, selectedSubZoneId]
  );
  const mappedReasonIds = useMemo(() => {
    const mappings = Array.isArray(config?.mappings) ? config.mappings : [];
    if (!selectedCategoryId || !selectedViewId || !selectedZoneId) return [];
    return mappings
      .filter((row) =>
        Number(row.categoryId) === Number(selectedCategoryId) &&
        Number(row.viewId) === Number(selectedViewId) &&
        Number(row.zoneId) === Number(selectedZoneId) &&
        Number(row.subZoneId || 0) === Number(selectedSubZoneId || 0)
      )
      .map((row) => Number(row.reasonId));
  }, [config, selectedCategoryId, selectedViewId, selectedZoneId, selectedSubZoneId]);

  const notify = (text, type = "info") => setMessage({ text, type });
  const requirePartName = () => {
    if (partName) return true;
    notify("Add or select a part first.", "error");
    return false;
  };

  const setLoadedConfig = (data, { preserveSelection = true } = {}) => {
    const normalizedViews = (data?.views || []).map((view) => ({ ...view, imageUrl: view.imageUrl || DUMMY_PART_IMAGE }));
    const normalizedData = { ...data, views: normalizedViews };
    setConfig(normalizedData);
    setImageDrafts(Object.fromEntries(normalizedViews.map((v) => [v.id, v.imageUrl || DUMMY_PART_IMAGE])));
    const cat = preserveSelection
      ? normalizedData?.categories?.find((row) => Number(row.id) === Number(selectedCategoryId)) || normalizedData?.categories?.[0] || null
      : normalizedData?.categories?.[0] || null;
    const view = preserveSelection
      ? normalizedData?.views?.find((row) => Number(row.id) === Number(selectedViewId)) || normalizedData?.views?.[0] || null
      : normalizedData?.views?.[0] || null;
    const zone = preserveSelection
      ? (view?.zones || []).find((row) => Number(row.id) === Number(selectedZoneId)) || view?.zones?.[0] || null
      : view?.zones?.[0] || null;
    setSelectedCategoryId(cat?.id || "");
    setSelectedViewId(view?.id || "");
    setSelectedZoneId(zone?.id || "");
    setSelectedSubZoneId(zone?.subZones?.[0]?.id || "");
    setSelectedReasonIds((cat?.reasons || []).map((r) => Number(r.id)));
  };

  const loadParts = async () => {
    try {
      const data = await rejectionConfigApi.parts();
      setPartOptions(Array.isArray(data?.parts) ? data.parts : []);
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to load parts.", "error");
    }
  };

  const loadConfig = async (_seed = false, targetPart = partName) => {
    setLoading(true);
    setMessage({ text: "", type: "info" });
    try {
      const clean = normalizePart(targetPart);
      if (!clean) throw new Error("Select a configured part first.");
      const data = await rejectionConfigApi.operatorConfig({ partName: clean });
      setPartName(clean);
      setLoadedConfig(data);
      await loadParts();
    } catch (err) {
      if (!config) {
        setLoadedConfig({ partName: normalizePart(targetPart), categories: [], views: [], mappings: [] });
      }
      notify(err?.response?.status === 404
        ? "Rejection config API not found. Restart backend after deploying the latest rejection config routes."
        : (err?.response?.data?.error || err?.message || "Unable to load rejection config."), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    rejectionConfigApi.parts().then((data) => {
      const parts = (Array.isArray(data?.parts) ? data.parts : []).filter((part) => part !== "DEFAULT");
      setPartOptions(parts);
      if (parts[0]) loadConfig(false, parts[0]);
      else setLoadedConfig({ partName: "", categories: [], views: [], mappings: [] });
    }).catch((err) => notify(err?.response?.data?.error || err?.message || "Unable to load parts.", "error"));
  }, []);

  useEffect(() => {
    if (!selectedCategory) { setSelectedReasonIds([]); return; }
    setSelectedReasonIds(mappedReasonIds.length ? mappedReasonIds : (selectedCategory.reasons || []).map((r) => Number(r.id)));
  }, [selectedCategoryId, selectedViewId, selectedZoneId, selectedSubZoneId, mappedReasonIds.join("|")]);

  useEffect(() => {
    const firstZone = selectedView?.zones?.[0] || null;
    if (!selectedZoneId || !(selectedView?.zones || []).some((zone) => Number(zone.id) === Number(selectedZoneId))) {
      setSelectedZoneId(firstZone?.id || "");
    }
  }, [selectedViewId, selectedView]);

  useEffect(() => {
    const firstSubZone = selectedZone?.subZones?.[0] || null;
    if (!selectedSubZoneId || !(selectedZone?.subZones || []).some((subZone) => Number(subZone.id) === Number(selectedSubZoneId))) {
      setSelectedSubZoneId(firstSubZone?.id || "");
    }
  }, [selectedZoneId, selectedZone]);

  // actions
  const submitNewPart = async () => {
    const clean = normalizePart(newPartName);
    if (!clean) {
      notify("Enter a part name first.", "error");
      return;
    }
    setPartName(clean);
    setLoadedConfig({ partName: clean, categories: [], views: [], mappings: [] }, { preserveSelection: false });
    setPartOptions((prev) => [clean, ...prev].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i));
    setActiveTab("parts");
    setModal("");
    setNewPartName("");
    notify(`Part ${clean} is ready. Add only the rejection details you need.`);
  };

  const openEditPart = (part) => {
    setEditTarget(part);
    setNewPartName(part || "");
    setModal("editPart");
  };

  const updatePartRecord = async () => {
    if (!editTarget) return;
    const clean = normalizePart(newPartName);
    if (!clean) return notify("Enter a part name first.", "error");
    setSaving(true);
    try {
      const data = await rejectionConfigApi.updatePart({ oldPartName: editTarget, newPartName: clean });
      setPartName(clean);
      setLoadedConfig(data);
      setModal("");
      setEditTarget(null);
      setNewPartName("");
      await loadParts();
      notify("Part updated.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to update part.", "error");
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (type, item, label, messageText) => {
    setDeleteTarget({ type, item, label, message: messageText });
  };

  const deletePartRecord = async (part) => {
    setSaving(true);
    try {
      const data = await rejectionConfigApi.deletePart(part, { partName: part });
      const nextPart = data?.nextPartName || "";
      await loadParts();
      if (nextPart) await loadConfig(false, nextPart);
      else {
        setPartName("");
        setLoadedConfig({ partName: "", categories: [], views: [], mappings: [] });
        setPartOptions([]);
      }
      notify("Part deleted.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to delete part.", "error");
    } finally {
      setSaving(false);
    }
  };

  const createCategory = async () => {
    if (!requirePartName()) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.createCategory({
        partName,
        name: categoryForm.name,
        reasons: splitLines(categoryForm.reasons),
      });
      setLoadedConfig(data);
      setCategoryForm({ name: "", reasons: "" });
      setModal("");
      notify("Category and reasons added.");
      await loadParts();
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to add category.", "error");
    } finally {
      setSaving(false);
    }
  };

  const addReasons = async () => {
    if (!requirePartName()) return;
    if (!selectedCategoryId) return notify("Select a category first.", "error");
    setSaving(true);
    try {
      const data = await rejectionConfigApi.addReasons({
        partName,
        categoryId: selectedCategoryId,
        reasons: splitLines(reasonText),
      });
      setLoadedConfig(data);
      setReasonText("");
      setModal("");
      notify("Reasons added successfully.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to add reasons.", "error");
    } finally {
      setSaving(false);
    }
  };

  const createView = async () => {
    if (!requirePartName()) return;
    setSaving(true);
    try {
      const zoneNames = splitLines(viewForm.zones);
      const gridZones = buildZoneGrid(zoneNames.map((zone) => ({
        code: zone,
        name: `Zone ${zone}`,
      })));
      const data = await rejectionConfigApi.createView({
        partName,
        name: viewForm.name,
        imageUrl: viewForm.imageUrl,
        zones: gridZones,
      });
      setLoadedConfig(data);
      setViewForm({ name: "", imageUrl: "", zones: "A\nB\nC\nD" });
      setModal("");
      notify("View and zones added.");
      await loadParts();
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to add view.", "error");
    } finally {
      setSaving(false);
    }
  };

  const addZones = async () => {
    if (!requirePartName()) return;
    if (!selectedViewId) return notify("Select a view first.", "error");
    setSaving(true);
    try {
      const existingCount = selectedView?.zones?.length || 0;
      const data = await rejectionConfigApi.addZones({
        partName,
        viewId: selectedViewId,
        zones: splitLines(zoneText).map((zone, index) => ({
          code: zone,
          name: `Zone ${zone}`,
          xPercent: 16 + ((existingCount + index) % 4) * 18,
          yPercent: 22 + Math.floor((existingCount + index) / 4) * 18,
          widthPercent: 10,
          heightPercent: 10,
        })),
      });
      const updatedView = (data?.views || []).find((view) => Number(view.id) === Number(selectedViewId));
      const gridZones = buildZoneGrid(updatedView?.zones || []);
      if (gridZones.length) {
        await Promise.all(gridZones.map((zone) => rejectionConfigApi.updateZone({
          partName,
          zoneId: zone.id,
          code: zone.code,
          name: zone.name,
          xPercent: zone.xPercent,
          yPercent: zone.yPercent,
          widthPercent: zone.widthPercent,
          heightPercent: zone.heightPercent,
        })));
      }
      setLoadedConfig(await rejectionConfigApi.operatorConfig({ partName }), { preserveSelection: true });
      setZoneText("");
      setModal("");
      notify("Zones added.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to add zones.", "error");
    } finally {
      setSaving(false);
    }
  };

  const addSubZones = async () => {
    if (!requirePartName()) return;
    if (!selectedZoneId) return notify("Select a zone first.", "error");
    setSaving(true);
    try {
      const existingCount = selectedZone?.subZones?.length || 0;
      const data = await rejectionConfigApi.addSubZones({
        partName,
        zoneId: selectedZoneId,
        subZones: splitLines(subZoneText).map((subZone, index) => ({
          code: subZone,
          name: `Sub Zone ${subZone}`,
          xPercent: 8 + ((existingCount + index) % 4) * 22,
          yPercent: 12 + Math.floor((existingCount + index) / 4) * 22,
          widthPercent: 18,
          heightPercent: 18,
        })),
      });
      setLoadedConfig(data, { preserveSelection: true });
      setSubZoneText("");
      setModal("");
      notify("Sub-zones added.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to add sub-zones.", "error");
    } finally {
      setSaving(false);
    }
  };

  const changeSelectedSubZoneLayout = (nextSubZones) => {
    if (!selectedViewId || !selectedZoneId) return;
    setConfig((prev) => ({
      ...prev,
      views: (prev?.views || []).map((view) => Number(view.id) !== Number(selectedViewId)
        ? view
        : {
          ...view,
          zones: (view.zones || []).map((zone) => Number(zone.id) !== Number(selectedZoneId)
            ? zone
            : { ...zone, subZones: nextSubZones }),
        }),
    }));
  };

  const saveSelectedSubZoneLayout = async () => {
    if (!requirePartName()) return;
    if (!selectedZone?.subZones?.length) return notify("Select a zone with sub-zones first.", "error");
    setSaving(true);
    try {
      await Promise.all(selectedZone.subZones.map((subZone) => rejectionConfigApi.updateSubZone({
        partName,
        subZoneId: subZone.id,
        code: subZone.code,
        name: subZone.name,
        xPercent: subZone.xPercent,
        yPercent: subZone.yPercent,
        widthPercent: subZone.widthPercent,
        heightPercent: subZone.heightPercent,
      })));
      setLoadedConfig(await rejectionConfigApi.operatorConfig({ partName }), { preserveSelection: true });
      notify("Sub-zone layout saved.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to save sub-zone layout.", "error");
    } finally {
      setSaving(false);
    }
  };

  const autoDivideSelectedSubZones = async () => {
    if (!requirePartName()) return;
    if (!selectedZone?.subZones?.length) return notify("Add sub-zones before auto dividing.", "error");
    const gridSubZones = buildZoneGrid(selectedZone.subZones);
    setSaving(true);
    try {
      await Promise.all(gridSubZones.map((subZone) => rejectionConfigApi.updateSubZone({
        partName,
        subZoneId: subZone.id,
        code: subZone.code,
        name: subZone.name,
        xPercent: subZone.xPercent,
        yPercent: subZone.yPercent,
        widthPercent: subZone.widthPercent,
        heightPercent: subZone.heightPercent,
      })));
      setLoadedConfig(await rejectionConfigApi.operatorConfig({ partName }), { preserveSelection: true });
      notify(`Zone divided into ${gridSubZones.length} sub-zone cells.`);
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to auto divide sub-zones.", "error");
    } finally {
      setSaving(false);
    }
  };

  const applyToAllZones = async () => {
    if (!requirePartName()) return;
    if (!selectedCategoryId || selectedReasonIds.length === 0) {
      return notify("Select a category and at least one reason first.", "error");
    }
    setSaving(true);
    try {
      const data = await rejectionConfigApi.applyReasonsAllZones({
        partName,
        categoryId: selectedCategoryId,
        reasonIds: selectedReasonIds,
      });
      setLoadedConfig(data);
      notify("Reasons applied to all views and zones.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to apply reasons.", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveViewImage = async (viewId) => {
    if (!requirePartName()) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.updateViewImage({ partName, viewId, imageUrl: imageDrafts[viewId] || "" });
      setLoadedConfig(data);
      notify("View image saved.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to save view image.", "error");
    } finally {
      setSaving(false);
    }
  };

  const browseViewImage = (viewId, file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      notify("Please choose an image file.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageDrafts((prev) => ({ ...prev, [viewId]: reader.result || "" }));
      notify("Image selected. Click save to update this view.");
    };
    reader.onerror = () => notify("Unable to read selected image.", "error");
    reader.readAsDataURL(file);
  };

  const saveZoneReasons = async () => {
    if (!requirePartName()) return;
    if (!selectedCategoryId || !selectedViewId || !selectedZoneId) {
      return notify("Select category, view and zone first.", "error");
    }
    setSaving(true);
    try {
      const data = await rejectionConfigApi.setZoneReasons({
        partName,
        categoryId: selectedCategoryId,
        viewId: selectedViewId,
        zoneId: selectedZoneId,
        subZoneId: selectedSubZoneId || null,
        reasonIds: selectedReasonIds,
      });
      setLoadedConfig(data);
      notify("Zone-wise reason list saved.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to save zone reason list.", "error");
    } finally {
      setSaving(false);
    }
  };

  const updateZoneDraft = (field, value) => {
    if (!selectedZone || !selectedView) return;
    setConfig((prev) => ({
      ...prev,
      views: (prev?.views || []).map((view) => Number(view.id) !== Number(selectedView.id) ? view : {
        ...view,
        zones: (view.zones || []).map((zone) => Number(zone.id) !== Number(selectedZone.id) ? zone : {
          ...zone,
          [field]: value,
        }),
      }),
    }));
  };

  const saveZonePosition = async () => {
    if (!requirePartName()) return;
    if (!selectedZone) return notify("Select a zone first.", "error");
    setSaving(true);
    try {
      const data = await rejectionConfigApi.updateZone({
        partName,
        zoneId: selectedZone.id,
        code: selectedZone.code,
        name: selectedZone.name,
        xPercent: selectedZone.xPercent,
        yPercent: selectedZone.yPercent,
        widthPercent: selectedZone.widthPercent,
        heightPercent: selectedZone.heightPercent,
      });
      setLoadedConfig(data);
      notify("Zone position saved.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to save zone position.", "error");
    } finally {
      setSaving(false);
    }
  };

  const dragZoneDraft = (zoneId, patch) => {
    const viewId = selectedViewId;
    setConfig((prev) => ({
      ...prev,
      views: (prev?.views || []).map((view) => Number(view.id) !== Number(viewId) ? view : {
        ...view,
        zones: (view.zones || []).map((zone) => Number(zone.id) !== Number(zoneId) ? zone : {
          ...zone,
          ...patch,
        }),
      }),
    }));
  };

  const changeSelectedViewLayout = (nextZones) => {
    if (!selectedViewId) return;
    setConfig((prev) => ({
      ...prev,
      views: (prev?.views || []).map((view) => Number(view.id) !== Number(selectedViewId)
        ? view
        : { ...view, zones: nextZones }),
    }));
  };

  const saveSelectedViewLayout = async () => {
    if (!requirePartName()) return;
    if (!selectedView?.zones?.length) return notify("Select a view with zones first.", "error");
    setSaving(true);
    try {
      await Promise.all(selectedView.zones.map((zone) => rejectionConfigApi.updateZone({
        partName,
        zoneId: zone.id,
        code: zone.code,
        name: zone.name,
        xPercent: zone.xPercent,
        yPercent: zone.yPercent,
        widthPercent: zone.widthPercent,
        heightPercent: zone.heightPercent,
      })));
      setLoadedConfig(await rejectionConfigApi.operatorConfig({ partName }));
      notify("Zone divider layout saved.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to save zone divider layout.", "error");
    } finally {
      setSaving(false);
    }
  };

  const autoDivideSelectedView = async () => {
    if (!requirePartName()) return;
    if (!selectedView?.zones?.length) return notify("Add zones before auto dividing the image.", "error");
    const gridZones = buildZoneGrid(selectedView.zones);
    setSaving(true);
    try {
      await Promise.all(gridZones.map((zone) => rejectionConfigApi.updateZone({
        partName,
        zoneId: zone.id,
        code: zone.code,
        name: zone.name,
        xPercent: zone.xPercent,
        yPercent: zone.yPercent,
        widthPercent: zone.widthPercent,
        heightPercent: zone.heightPercent,
      })));
      setLoadedConfig(await rejectionConfigApi.operatorConfig({ partName }), { preserveSelection: true });
      notify(`Image divided into ${gridZones.length} adjustable zone cells.`);
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to auto divide zones.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openEditCategory = (category) => {
    setEditTarget(category);
    setCategoryForm({ name: category?.name || "", reasons: "" });
    setModal("editCategory");
  };

  const updateCategoryRecord = async () => {
    if (!requirePartName()) return;
    if (!editTarget?.id) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.updateCategory({ partName, categoryId: editTarget.id, name: categoryForm.name });
      setLoadedConfig(data);
      setModal("");
      setEditTarget(null);
      notify("Category updated.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to update category.", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteCategoryRecord = async (category) => {
    if (!requirePartName()) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.deleteCategory(category.id, { partName });
      setLoadedConfig(data);
      await loadParts();
      notify("Category deleted.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to delete category.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openEditReason = (reason) => {
    setEditTarget(reason);
    setReasonText(reason?.name || "");
    setModal("editReason");
  };

  const updateReasonRecord = async () => {
    if (!requirePartName()) return;
    if (!editTarget?.id) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.updateReason({ partName, reasonId: editTarget.id, name: reasonText });
      setLoadedConfig(data);
      setModal("");
      setEditTarget(null);
      notify("Reason updated.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to update reason.", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteReasonRecord = async (reason) => {
    if (!requirePartName()) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.deleteReason(reason.id, { partName });
      setLoadedConfig(data);
      notify("Reason deleted.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to delete reason.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openEditView = (view) => {
    setEditTarget(view);
    setViewForm({ name: view?.name || "", imageUrl: imageDrafts[view?.id] || view?.imageUrl || "", zones: "A\nB\nC\nD" });
    setModal("editView");
  };

  const updateViewRecord = async () => {
    if (!requirePartName()) return;
    if (!editTarget?.id) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.updateView({
        partName,
        viewId: editTarget.id,
        name: viewForm.name,
        imageUrl: viewForm.imageUrl,
      });
      setLoadedConfig(data);
      setModal("");
      setEditTarget(null);
      notify("View updated.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to update view.", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteViewRecord = async (view) => {
    if (!requirePartName()) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.deleteView(view.id, { partName });
      setLoadedConfig(data);
      await loadParts();
      notify("View deleted.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to delete view.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openEditZone = (zone) => {
    setSelectedZoneId(zone.id);
    setEditTarget(zone);
    setZoneText(zone?.name || "");
    setModal("editZone");
  };

  const updateZoneRecord = async () => {
    if (!requirePartName()) return;
    if (!editTarget?.id) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.updateZone({
        partName,
        zoneId: editTarget.id,
        name: zoneText,
      });
      setLoadedConfig(data);
      setModal("");
      setEditTarget(null);
      notify("Zone updated.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to update zone.", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteZoneRecord = async (zone) => {
    if (!requirePartName()) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.deleteZone(zone.id, { partName });
      setLoadedConfig(data);
      notify("Zone deleted.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to delete zone.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openEditSubZone = (subZone) => {
    setSelectedSubZoneId(subZone.id);
    setEditTarget(subZone);
    setSubZoneText(subZone?.name || "");
    setModal("editSubZone");
  };

  const updateSubZoneRecord = async () => {
    if (!requirePartName()) return;
    if (!editTarget?.id) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.updateSubZone({
        partName,
        subZoneId: editTarget.id,
        name: subZoneText,
      });
      setLoadedConfig(data, { preserveSelection: true });
      setModal("");
      setEditTarget(null);
      notify("Sub-zone updated.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to update sub-zone.", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteSubZoneRecord = async (subZone) => {
    if (!requirePartName()) return;
    setSaving(true);
    try {
      const data = await rejectionConfigApi.deleteSubZone(subZone.id, { partName });
      setLoadedConfig(data, { preserveSelection: true });
      notify("Sub-zone deleted.");
    } catch (err) {
      notify(err?.response?.data?.error || err?.message || "Unable to delete sub-zone.", "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    if (target.type === "part") return deletePartRecord(target.item);
    if (target.type === "category") return deleteCategoryRecord(target.item);
    if (target.type === "reason") return deleteReasonRecord(target.item);
    if (target.type === "view") return deleteViewRecord(target.item);
    if (target.type === "zone") return deleteZoneRecord(target.item);
    if (target.type === "subZone") return deleteSubZoneRecord(target.item);
  };

  const toggleReason = (reasonId) => {
    const id = Number(reasonId);
    setSelectedReasonIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const zoneCount = views.reduce((sum, v) => sum + (v.zones?.length || 0), 0);
  const reasonCount = categories.reduce((sum, r) => sum + (r.reasons?.length || 0), 0);

  return (
    <div className="space-y-5 rise-in" style={{ fontFamily: "var(--font-outfit)" }}>
      {/* ── header ── */}
      <div className="db-header-card mb-2">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box"><ShieldCheck size={22} /></div>
            <div>
              <h1 className="db-header-title">Rejection Configuration</h1>
              <p className="db-header-subtitle">parts, views, zones, categories &amp; reasons</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={partName}
              onChange={(e) => loadConfig(false, e.target.value)}
              className="rounded-lg border border-border bg-bg-card px-3 py-2 text-sm font-bold text-text-main outline-none focus:border-primary"
            >
              {[partName, ...partOptions].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map((part) => (
                <option key={part} value={part}>{part}</option>
              ))}
            </select>
            <button onClick={() => loadConfig(false)} disabled={loading || !partName} className="db-action-btn">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ── stats strip ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Categories", value: categories.length, color: "text-violet-400" },
          { label: "Views",       value: views.length,      color: "text-sky-400" },
          { label: "Zones",       value: zoneCount,         color: "text-primary" },
          { label: "Reasons",     value: reasonCount,       color: "text-emerald-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border bg-bg-elevated p-3">
            <p className="text-[10px] font-black uppercase text-text-muted">{label}</p>
            <p className={`text-2xl font-black ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── message ── */}
      {message.text && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm font-bold ${
          message.type === "error"
            ? "border-red-500/30 bg-red-500/10 text-red-400"
            : "border-green-500/30 bg-green-500/10 text-green-400"
        }`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage({ text: "", type: "info" })}><X size={14} /></button>
        </div>
      )}

      {/* ── tab bar ── */}
      <div className="flex overflow-x-auto rounded-xl border border-border bg-bg-dark/40 p-1 gap-1">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex min-w-max items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-black uppercase tracking-wide transition-colors ${
              activeTab === id
                ? "bg-primary text-white shadow-sm"
                : "text-text-muted hover:bg-bg-elevated hover:text-text-main"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* ── tab content ── */}
      {activeTab === "parts" && (
        <PartMasterTab
          partOptions={[partName, ...partOptions].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)}
          partName={partName}
          onSelectPart={(p) => loadConfig(false, p)}
          onAddPart={() => {
            setNewPartName("");
            setModal("part");
          }}
          onEditPart={openEditPart}
          onDeletePart={(part) => requestDelete("part", part, part, `Delete part "${part}" and all rejection configuration?`)}
        />
      )}

      {activeTab === "views" && (
        <ViewSetupTab
          views={views}
          partName={partName}
          imageDrafts={imageDrafts}
          setImageDrafts={setImageDrafts}
          onAddView={() => setModal("view")}
          onSaveImage={saveViewImage}
          onBrowseImage={browseViewImage}
          onEditView={openEditView}
          onDeleteView={(view) => requestDelete("view", view, view?.name, `Delete view "${view?.name}" and all its zones?`)}
          saving={saving}
        />
      )}

      {activeTab === "zones" && (
        <ZoneDesignerTab
          views={views}
          selectedViewId={selectedViewId}
          setSelectedViewId={setSelectedViewId}
          selectedZoneId={selectedZoneId}
          setSelectedZoneId={setSelectedZoneId}
          selectedView={selectedView}
          onAddZones={() => setModal("zone")}
          onEditZone={openEditZone}
          onDeleteZone={(zone) => requestDelete("zone", zone, zone?.name || zone?.code, `Delete zone "${zone?.name || zone?.code}"?`)}
          onChangeLayout={changeSelectedViewLayout}
          onAutoDivide={autoDivideSelectedView}
          onSaveLayout={saveSelectedViewLayout}
          saving={saving}
        />
      )}

      {activeTab === "subzones" && (
        <SubZoneDesignerTab
          views={views}
          selectedViewId={selectedViewId}
          setSelectedViewId={setSelectedViewId}
          selectedZoneId={selectedZoneId}
          setSelectedZoneId={setSelectedZoneId}
          selectedSubZoneId={selectedSubZoneId}
          setSelectedSubZoneId={setSelectedSubZoneId}
          selectedView={selectedView}
          selectedZone={selectedZone}
          onAddSubZones={() => setModal("subZone")}
          onEditSubZone={openEditSubZone}
          onDeleteSubZone={(subZone) => requestDelete("subZone", subZone, subZone?.name || subZone?.code, `Delete sub-zone "${subZone?.name || subZone?.code}"?`)}
          onChangeSubZoneLayout={changeSelectedSubZoneLayout}
          onAutoDivideSubZones={autoDivideSelectedSubZones}
          onSaveSubZoneLayout={saveSelectedSubZoneLayout}
          saving={saving}
        />
      )}

      {activeTab === "assign" && (
        <AssignmentTab
          categories={categories}
          views={views}
          selectedCategoryId={selectedCategoryId}
          setSelectedCategoryId={setSelectedCategoryId}
          selectedViewId={selectedViewId}
          setSelectedViewId={setSelectedViewId}
          selectedZoneId={selectedZoneId}
          setSelectedZoneId={setSelectedZoneId}
          selectedSubZoneId={selectedSubZoneId}
          setSelectedSubZoneId={setSelectedSubZoneId}
          selectedCategory={selectedCategory}
          selectedView={selectedView}
          selectedZone={selectedZone}
          selectedSubZone={selectedSubZone}
          selectedReasonIds={selectedReasonIds}
          toggleReason={toggleReason}
          onSaveZoneReasons={saveZoneReasons}
          onSaveZonePosition={saveZonePosition}
          updateZoneDraft={updateZoneDraft}
          onDragZone={dragZoneDraft}
          onChangeLayout={changeSelectedViewLayout}
          onSaveLayout={saveSelectedViewLayout}
          onAutoDivide={autoDivideSelectedView}
          saving={saving}
        />
      )}

      {activeTab === "categories" && (
        <CategoryTab
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          setSelectedCategoryId={setSelectedCategoryId}
          onAddCategory={() => setModal("category")}
          onEditCategory={openEditCategory}
          onDeleteCategory={(cat) => requestDelete("category", cat, cat?.label || cat?.name, `Delete category "${cat?.label || cat?.name}" and its reasons?`)}
        />
      )}

      {activeTab === "reasons" && (
        <ReasonTab
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          setSelectedCategoryId={setSelectedCategoryId}
          selectedReasonIds={selectedReasonIds}
          toggleReason={toggleReason}
          onAddReasons={() => setModal("reason")}
          onApplyAll={applyToAllZones}
          onEditReason={openEditReason}
          onDeleteReason={(reason) => requestDelete("reason", reason, reason?.name, `Delete reason "${reason?.name}"?`)}
          saving={saving}
        />
      )}

      {/* ── modals ── */}
      {modal === "part" && (
        <Modal title="Add New Part" onClose={() => setModal("")}>
          <Field label="Part Name" value={newPartName} onChange={setNewPartName} placeholder="OIL PAN K12" />
          <p className="mt-2 text-[11px] font-bold text-text-muted">Part name will be uppercased. Rejection details will stay empty until you add them.</p>
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={submitNewPart} label="Add Part" icon={Plus} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "editPart" && (
        <Modal title="Edit Part" onClose={() => setModal("")}>
          <Field label="Part Name" value={newPartName} onChange={setNewPartName} placeholder="OIL PAN K12" />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={updatePartRecord} label="Update Part" icon={Save} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "category" && (
        <Modal title="Add Rejection Category" onClose={() => setModal("")}>
          <Field label="Category Name" value={categoryForm.name} onChange={(v) => setCategoryForm((p) => ({ ...p, name: v }))} placeholder="Casting Defect" />
          <MultiLineField
            label="Rejection Reasons (one per line or comma separated)"
            value={categoryForm.reasons}
            onChange={(v) => setCategoryForm((p) => ({ ...p, reasons: v }))}
            placeholder={"Blow Hole\nPorosity\nCrack\nBurr"}
          />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={createCategory} label="Save Category" icon={Save} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "editCategory" && (
        <Modal title="Edit Rejection Category" onClose={() => setModal("")}>
          <Field label="Category Name" value={categoryForm.name} onChange={(v) => setCategoryForm((p) => ({ ...p, name: v }))} placeholder="Casting Defect" />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={updateCategoryRecord} label="Update Category" icon={Save} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "reason" && (
        <Modal title={`Add Reasons — ${selectedCategory ? categoryDisplayName(selectedCategory) : "Category"}`} onClose={() => setModal("")}>
          <MultiLineField label="Reasons (one per line or comma separated)" value={reasonText} onChange={setReasonText} placeholder={"Scratch\nDent\nLeakage"} />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={addReasons} label="Add Reasons" icon={Plus} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "editReason" && (
        <Modal title="Edit Reason" onClose={() => setModal("")}>
          <Field label="Reason Name" value={reasonText} onChange={setReasonText} placeholder="Blow Hole" />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={updateReasonRecord} label="Update Reason" icon={Save} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "view" && (
        <Modal title="Add View" onClose={() => setModal("")}>
          <Field label="View Name" value={viewForm.name} onChange={(v) => setViewForm((p) => ({ ...p, name: v }))} placeholder="Top View" />
          <ImageInputField
            label="View Image"
            value={viewForm.imageUrl}
            onChange={(v) => setViewForm((p) => ({ ...p, imageUrl: v }))}
            inputId="add-view-image"
            onError={(message) => notify(message, "error")}
          />
          <MultiLineField label="Zones (one per line)" value={viewForm.zones} onChange={(v) => setViewForm((p) => ({ ...p, zones: v }))} placeholder={"A\nB\nC\nD"} />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={createView} label="Add View" icon={Plus} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "editView" && (
        <Modal title="Edit View" onClose={() => setModal("")}>
          <Field label="View Name" value={viewForm.name} onChange={(v) => setViewForm((p) => ({ ...p, name: v }))} placeholder="Top View" />
          <ImageInputField
            label="View Image"
            value={viewForm.imageUrl}
            onChange={(v) => setViewForm((p) => ({ ...p, imageUrl: v }))}
            inputId="edit-view-image"
            onError={(message) => notify(message, "error")}
          />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={updateViewRecord} label="Update View" icon={Save} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "zone" && (
        <Modal title={`Add Zones — ${selectedView?.name || "View"}`} onClose={() => setModal("")}>
          <MultiLineField label="Zone Names (one per line)" value={zoneText} onChange={setZoneText} placeholder={"A\nB\nC\nD"} />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={addZones} label="Add Zones" icon={Plus} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "subZone" && (
        <Modal title={`Add Sub Zones — ${selectedZone?.name || "Zone"}`} onClose={() => setModal("")}>
          <MultiLineField label="Sub Zone Names (one per line)" value={subZoneText} onChange={setSubZoneText} placeholder={"E-1\nE-2\nE-3"} />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={addSubZones} label="Add Sub Zones" icon={Plus} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "editZone" && (
        <Modal title="Edit Zone" onClose={() => setModal("")}>
          <Field label="Zone Name" value={zoneText} onChange={setZoneText} placeholder="Zone A" />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={updateZoneRecord} label="Update Zone" icon={Save} disabled={saving} />
          </div>
        </Modal>
      )}

      {modal === "editSubZone" && (
        <Modal title="Edit Sub Zone" onClose={() => setModal("")}>
          <Field label="Sub Zone Name" value={subZoneText} onChange={setSubZoneText} placeholder="Sub Zone E-1" />
          <div className="mt-5 flex justify-end gap-2">
            <ActionButton onClick={() => setModal("")} label="Cancel" />
            <ActionButton primary onClick={updateSubZoneRecord} label="Update Sub Zone" icon={Save} disabled={saving} />
          </div>
        </Modal>
      )}

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.type || "item"}?`}
        message={deleteTarget?.message || "This action cannot be undone."}
        confirmText={saving ? "Deleting..." : "Delete"}
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default RejectionConfiguration;
