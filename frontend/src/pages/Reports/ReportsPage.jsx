import React, { useState, useEffect, useCallback } from 'react';
import { reportApi, machineApi } from '../../api/services';
import { loadReportConfig } from '../../utils/reportConfig';
import { toDatetimeLocal } from '../../utils/time';
import ReportFilters from './ReportFilters';
import ReportSummaryCards from './ReportSummaryCards';
import ReportTable from './ReportTable';
import ExportButtons from './ExportButtons';
import { FileText, Download } from 'lucide-react';
import toast from 'react-hot-toast';

const ReportsPage = () => {
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [machines, setMachines] = useState([]);
  const [data, setData] = useState({ rows: [], metrics: {} });
  
  const [filters, setFilters] = useState({
    dateFrom: toDatetimeLocal(new Date(new Date().setHours(0,0,0,0))),
    dateTo: toDatetimeLocal(new Date(new Date().setHours(23,59,59,999))),
    machineId: '',
    lineName: '',
    shiftCode: '',
    resultType: '',
    modelCode: '',
    operationNo: ''
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await reportApi.getData(filters);
      // Client-side result resolution to match the table display
      const enrichedRows = (response.rows || []).map(row => {
        // Simple client-side mapping for the table (actual logic is in backend too)
        const reason = String(row.interlock_reason || "").toUpperCase();
        const plcStatus = String(row.plc_status || "").toUpperCase();
        const res = String(row.result || "").toUpperCase();

        let industrialResult = "UNKNOWN";
        if (reason.includes("DUPLICATE")) industrialResult = "DUPLICATE";
        else if (reason.includes("PREVIOUS")) industrialResult = "PREVIOUS STATION PENDING";
        else if (reason.includes("VALIDATION") || reason.includes("INTERLOCK")) industrialResult = "VALIDATION REJECT";
        else if (res === "OK" || plcStatus === "ENDED_OK") industrialResult = "OK";
        else if (res === "NG" || plcStatus === "ENDED_NG") industrialResult = "NG";
        
        return { ...row, industrialResult };
      });

      setData({
        rows: enrichedRows,
        metrics: response.metrics || {}
      });
    } catch (e) {
      console.error(e);
      toast.error("Failed to load production analytics");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    machineApi.list().then(setMachines).catch(console.error);
    fetchData();
  }, []);

  const handleExport = async (type) => {
    setExportLoading(true);
    const toastId = toast.loading(`Preparing ${type.toUpperCase()} report...`);
    try {
      const reportConfig = loadReportConfig();
      let blob;

      // Pass filters and reportConfig as separate args — services.js builds the body correctly
      if (type === 'full')  blob = await reportApi.exportFull(filters, reportConfig);
      else if (type === 'ng')    blob = await reportApi.exportNG(filters, reportConfig);
      else if (type === 'parts') blob = await reportApi.exportParts(filters, reportConfig);
      else if (type === 'audit') blob = await reportApi.exportAudit(filters, reportConfig);

      if (!blob) throw new Error("Empty response from export engine");

      const url  = window.URL.createObjectURL(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement('a');
      link.href  = url;
      const ts   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      link.setAttribute('download', `${type.toUpperCase()}_REPORT_${ts}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Report downloaded successfully", { id: toastId });
    } catch (e) {
      console.error("Export failed:", e);
      toast.error(e?.response?.data?.error || "Export failed — check console", { id: toastId });
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 rise-in">
      {/* Page Header */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <FileText size={22} />
            </div>
            <div>
              <h1 className="db-header-title text-text-main">Production Analytics & Reports</h1>
              <p className="db-header-subtitle">Standardized MES Traceability Reporting Engine</p>
            </div>
          </div>
          <div className="bg-bg-dark/50 border border-border rounded-lg px-4 py-2 flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[9px] font-black text-text-muted uppercase tracking-widest">Database State</span>
              <span className="text-[11px] font-bold text-green-500 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live Ready
              </span>
            </div>
            <div className="w-px h-6 bg-border" />
            <div className="flex flex-col">
              <span className="text-[9px] font-black text-text-muted uppercase tracking-widest">Compliance</span>
              <span className="text-[11px] font-bold text-primary flex items-center gap-1.5">
                <Download size={10} /> Audit Validated
              </span>
            </div>
          </div>
        </div>
      </div>

      <ExportButtons onExport={handleExport} loading={exportLoading} />
      
      <ReportFilters 
        filters={filters} 
        onFilterChange={setFilters} 
        onApply={fetchData}
        onClear={() => setFilters({
          dateFrom: toDatetimeLocal(new Date(new Date().setHours(0,0,0,0))),
          dateTo: toDatetimeLocal(new Date(new Date().setHours(23,59,59,999))),
          machineId: '', lineName: '', shiftCode: '', resultType: '', modelCode: '', operationNo: ''
        })}
        machines={machines}
      />

      <ReportSummaryCards metrics={data.metrics} />

      <ReportTable rows={data.rows} loading={loading} />
    </div>
  );
};

export default ReportsPage;
