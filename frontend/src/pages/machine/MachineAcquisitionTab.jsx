import React from "react";

export default function MachineAcquisitionTab({
  form,
  setF,
  addDynamicRegister,
  updateDynamicRegister,
  removeDynamicRegister,
  handleTestConnection,
  UI,
}) {
  const { C, SectionCard, Label, FInput, FSelect, Toggle, IconBtn, Plus, Trash2, Zap, Activity, Database, TableProperties } = UI;
  const mode = String(form.spcMode || "TCP_CLIENT").toUpperCase();
  const isPlc = ["PLC_SLMP", "MODBUS_TCP"].includes(mode);
  const isFile = mode === "FILE_WATCHER";
  const isUsb = mode === "USB_SCANNER";
  const isSerial = mode === "SERIAL";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionCard title="Protocol Selection" subtitle="Use one active protocol profile" icon={UI.ScanLine}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <Label>Protocol</Label>
            <FSelect value={form.spcMode} onChange={(e) => { const m = e.target.value; setF("spcMode", m); setF("spcActiveProtocols", [m]); setF("spcPriority", [m]); }}>
              {(UI.ACQUISITION_PROTOCOLS || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </FSelect>
          </div>
          <div>
            <Label>Enabled</Label>
            <Toggle checked={form.spcEnabled} onChange={(v) => setF("spcEnabled", v)} color={C.green} />
          </div>
        </div>
      </SectionCard>

      {form.spcEnabled && (
        <>
          <SectionCard title="Protocol Configuration" subtitle="Protocol-specific settings only" icon={Database}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
              {(isPlc || mode === "TCP_CLIENT" || mode === "TCP_SERVER") && <div><Label>Source IP</Label><FInput value={form.spcSourceIp} onChange={(e)=>setF("spcSourceIp", e.target.value)} mono /></div>}
              {(isPlc || mode === "TCP_CLIENT" || mode === "TCP_SERVER") && <div><Label>Source Port</Label><FInput type="number" value={form.spcSourcePort} onChange={(e)=>setF("spcSourcePort", e.target.value)} mono /></div>}
              {(isPlc || mode === "TCP_CLIENT" || mode === "TCP_SERVER") && <div><Label>Result Key/Register</Label><FInput value={form.spcPayloadKey} onChange={(e)=>setF("spcPayloadKey", e.target.value)} /></div>}
              {isFile && <div><Label>Folder Path</Label><FInput value={form.spcFolderPath} onChange={(e)=>setF("spcFolderPath", e.target.value)} mono /></div>}
              {isFile && <div><Label>File Pattern</Label><FInput value={form.spcFolderPattern} onChange={(e)=>setF("spcFolderPattern", e.target.value)} /></div>}
              {isFile && <div><Label>Parser</Label><FSelect value={form.spcFolderParser} onChange={(e)=>setF("spcFolderParser", e.target.value)}><option>JSON</option><option>CSV</option><option>DELIMITER</option><option>REGEX</option><option>RAW_TEXT</option></FSelect></div>}
              {isSerial && <div><Label>COM Port</Label><FInput value={form.spcSourceIp} onChange={(e)=>setF("spcSourceIp", e.target.value)} placeholder="COM3" /></div>}
              {isSerial && <div><Label>Baud</Label><FInput type="number" value={form.spcSourcePort} onChange={(e)=>setF("spcSourcePort", e.target.value)} placeholder="9600" /></div>}
              {isUsb && <div><Label>Scanner Mode</Label><FInput value={form.spcPayloadKey} onChange={(e)=>setF("spcPayloadKey", e.target.value)} placeholder="HIDDEN_INPUT" /></div>}
            </div>
          </SectionCard>

          <SectionCard title="Dynamic Field Mapping" subtitle="Map source data to MES quality fields" icon={TableProperties}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(form.spcDynamicRegisters || []).map((row, i) => (
                <div key={row.id || i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 90px 120px 80px 28px", gap: 6, alignItems: "end", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 7 }}>
                  <div><Label>Label</Label><FInput value={row.name} onChange={(e)=>updateDynamicRegister(i,"name",e.target.value)} /></div>
                  <div><Label>Register</Label><FInput type="number" value={row.register} onChange={(e)=>updateDynamicRegister(i,"register",e.target.value)} /></div>
                  <div><Label>Device</Label><FSelect value={row.device || "D"} onChange={(e)=>updateDynamicRegister(i,"device",e.target.value)}>{(UI.DEVICES||[]).map((d)=><option key={d} value={d}>{d}</option>)}</FSelect></div>
                  <div><Label>Type</Label><FSelect value={row.type || "INT16"} onChange={(e)=>updateDynamicRegister(i,"type",e.target.value)}>{(UI.DATA_TYPES||[]).map((t)=><option key={t} value={t}>{t}</option>)}</FSelect></div>
                  <div><Label>Save As</Label><FInput value={row.saveAs || ""} onChange={(e)=>updateDynamicRegister(i,"saveAs",e.target.value)} /></div>
                  <div><Label>Required</Label><FSelect value={String(Boolean(row.required))} onChange={(e)=>updateDynamicRegister(i,"required",e.target.value==="true")}><option value="false">No</option><option value="true">Yes</option></FSelect></div>
                  <div><IconBtn icon={Trash2} title="Remove" onClick={() => removeDynamicRegister(i)} color={C.red} hoverColor={C.red} hoverBg={C.redLt} /></div>
                </div>
              ))}
              <button type="button" onClick={addDynamicRegister} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.sec, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Plus size={12} /> Add Field</button>
            </div>
          </SectionCard>

          {!isUsb && (
            <SectionCard title="Reliability Controls" subtitle="Timeout/retry controls" icon={Activity}>
              <div style={{ display: "grid", gridTemplateColumns: "140px 140px 160px", gap: 10 }}>
                <div><Label>Retry Count</Label><FInput type="number" value={form.spcRetryCount} onChange={(e)=>setF("spcRetryCount", e.target.value)} /></div>
                <div><Label>Retry Delay ms</Label><FInput type="number" value={form.spcRetryDelayMs} onChange={(e)=>setF("spcRetryDelayMs", e.target.value)} /></div>
                <div><Label>Timeout ms</Label><FInput type="number" value={form.spcTimeoutMs} onChange={(e)=>setF("spcTimeoutMs", e.target.value)} /></div>
              </div>
            </SectionCard>
          )}

          <SectionCard title="Test Connection & Review Data" subtitle="Protocol scoped test" icon={Zap}>
            <button type="button" onClick={handleTestConnection} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.greenBd}`, background: C.greenLt, color: C.green, fontSize: 12, fontWeight: 700, cursor: "pointer" }}><Zap size={13} /> Test Connection</button>
          </SectionCard>
        </>
      )}
    </div>
  );
}
