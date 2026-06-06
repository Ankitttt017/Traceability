import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import controlPlanFile from "../assets/documents/CP-100  Pan Oil  K-12. 850T.xls?url";

function getColumnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function normalizeColor(color) {
  const rgb = color?.rgb;
  if (!rgb) return "";
  const normalized = String(rgb).replace(/^FF/i, "");
  return normalized.length === 6 ? `#${normalized}` : "";
}

function normalizeBorder(border = {}) {
  const edge = border.style || border.color?.rgb ? border : null;
  if (!edge) return "1px solid #cbd5e1";

  const styleMap = {
    thin: "1px solid",
    medium: "2px solid",
    thick: "3px solid",
    dashed: "1px dashed",
    dotted: "1px dotted",
    double: "3px double",
  };

  const line = styleMap[edge.style] || "1px solid";
  const color = normalizeColor(edge.color) || "#94a3b8";
  return `${line} ${color}`;
}

function getCellStyle(cell) {
  const style = cell?.s || {};
  const fontColor = normalizeColor(style.font?.color);
  const fillColor = normalizeColor(style.fgColor) || "#ffffff";
  const horizontal = style.alignment?.horizontal || (cell?.t === "n" ? "right" : "left");
  const vertical = style.alignment?.vertical || "middle";

  return {
    backgroundColor: fillColor,
    color: fontColor || "#0f172a",
    fontWeight: style.font?.bold ? 700 : 400,
    fontStyle: style.font?.italic ? "italic" : "normal",
    fontSize: style.font?.sz ? `${style.font.sz}px` : "13px",
    textAlign: horizontal,
    verticalAlign: vertical === "center" ? "middle" : vertical,
    borderTop: normalizeBorder(style.border?.top),
    borderRight: normalizeBorder(style.border?.right),
    borderBottom: normalizeBorder(style.border?.bottom),
    borderLeft: normalizeBorder(style.border?.left),
  };
}

function getSheetAccent(model) {
  for (const row of model.rows) {
    for (const cell of row.cells) {
      if (cell.style.backgroundColor && cell.style.backgroundColor !== "#ffffff") {
        return cell.style.backgroundColor;
      }
    }
  }
  return "#dbeafe";
}

function buildSheetModel(worksheet) {
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
  const merges = worksheet["!merges"] || [];
  const mergeMap = new Map();
  const hiddenCells = new Set();

  merges.forEach((merge) => {
    mergeMap.set(`${merge.s.r}:${merge.s.c}`, merge);
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let col = merge.s.c; col <= merge.e.c; col += 1) {
        if (row === merge.s.r && col === merge.s.c) continue;
        hiddenCells.add(`${row}:${col}`);
      }
    }
  });

  const columnWidths = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const widthInfo = worksheet["!cols"]?.[col];
    const widthPx = widthInfo?.wpx || (widthInfo?.wch ? Math.round(widthInfo.wch * 8 + 16) : 120);
    columnWidths.push(widthPx);
  }

  const rows = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const cells = [];
    let rowHeight = worksheet["!rows"]?.[row]?.hpx || 28;

    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const key = `${row}:${col}`;
      if (hiddenCells.has(key)) continue;

      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[address];
      const merge = mergeMap.get(key);
      const rowSpan = merge ? merge.e.r - merge.s.r + 1 : 1;
      const colSpan = merge ? merge.e.c - merge.s.c + 1 : 1;

      if (merge) {
        for (let mergeRow = merge.s.r; mergeRow <= merge.e.r; mergeRow += 1) {
          const mergeHeight = worksheet["!rows"]?.[mergeRow]?.hpx || 28;
          rowHeight = Math.max(rowHeight, mergeHeight);
        }
      }

      cells.push({
        key,
        value: cell ? XLSX.utils.format_cell(cell) : "",
        rowSpan,
        colSpan,
        type: cell?.t || "",
        style: getCellStyle(cell),
      });
    }

    rows.push({
      index: row,
      height: rowHeight,
      cells,
    });
  }

  return {
    columnLabels: Array.from(
      { length: range.e.c - range.s.c + 1 },
      (_, index) => getColumnLabel(range.s.c + index)
    ),
    columnWidths,
    rows,
  };
}

function ControlPlan() {
  const [sheets, setSheets] = useState([]);
  const [activeSheetName, setActiveSheetName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadWorkbook() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(controlPlanFile);
        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const loadedSheets = workbook.SheetNames.map((name) => ({
          name,
          model: buildSheetModel(workbook.Sheets[name]),
        })).map((sheet) => ({
          ...sheet,
          accent: getSheetAccent(sheet.model),
        }));

        if (cancelled) return;
        setSheets(loadedSheets);
        setActiveSheetName(loadedSheets[0]?.name || "");
      } catch (loadError) {
        if (cancelled) return;
        setError("Unable to load the control plan sheet.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadWorkbook();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeSheet = useMemo(
    () => sheets.find((sheet) => sheet.name === activeSheetName)?.model || null,
    [activeSheetName, sheets]
  );

  return (
    <div className="h-screen overflow-auto bg-white text-slate-900">
      <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-3 border-b border-slate-300 bg-[#f3f3f3] px-3 py-2">
        <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
          
          {sheets.map((sheet) => (
            <button
              key={sheet.name}
              type="button"
              onClick={() => setActiveSheetName(sheet.name)}
              style={
                sheet.name === activeSheetName
                  ? {
                      backgroundColor: sheet.accent,
                      borderColor: sheet.accent,
                      color: "#0f172a",
                      boxShadow: `inset 0 -2px 0 #ffffff, 0 6px 18px ${sheet.accent}55`,
                    }
                  : {
                      backgroundColor: `${sheet.accent}22`,
                      borderColor: `${sheet.accent}66`,
                      color: "#334155",
                    }
              }
              className={`rounded-t-lg border px-4 py-1.5 text-sm font-medium whitespace-nowrap transition hover:-translate-y-[1px] ${
                sheet.name === activeSheetName
                  ? "border-b-white"
                  : "hover:brightness-105"
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
        <a
          href={controlPlanFile}
          download="CP-100 Pan Oil K-12 850T.xls"
          className="flex shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          title="Download Excel sheet"
        >
          <Download size={16} />
          <span>Download</span>
        </a>
      </div>

      {loading ? (
        <div className="flex min-h-[calc(100vh-44px)] items-center justify-center text-sm text-slate-500">
          Loading control plan sheet...
        </div>
      ) : error ? (
        <div className="flex min-h-[calc(100vh-44px)] items-center justify-center text-sm text-rose-600">
          {error}
        </div>
      ) : (
        <div className="overflow-auto bg-white p-2">
          <table className="min-w-max border-separate border-spacing-0 text-sm text-slate-900">
            <colgroup>
              <col style={{ width: 52 }} />
              {activeSheet?.columnWidths.map((width, index) => (
                <col key={activeSheet.columnLabels[index]} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 border border-slate-300 bg-[#f3f3f3]" />
                {activeSheet?.columnLabels.map((label) => (
                  <th
                    key={label}
                    className="sticky top-0 z-20 border border-slate-300 bg-[#f3f3f3] px-2 py-1 text-center font-medium text-slate-700"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeSheet?.rows.map((row) => (
                <tr key={row.index} style={{ height: row.height }}>
                  <th className="sticky left-0 z-10 border border-slate-300 bg-[#f3f3f3] px-2 py-1 text-center font-medium text-slate-700">
                    {row.index + 1}
                  </th>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.key}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      style={cell.style}
                      className="px-2 py-1 whitespace-pre-wrap"
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ControlPlan;
