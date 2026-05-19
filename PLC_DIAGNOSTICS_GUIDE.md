# PLC Read/Write Troubleshooting Guide

## Issue Summary
**Machine Page showing:** "PLC packet timeout" when testing SLMP registers on port 1025
**Root Cause:** TCP connects ✓ but SLMP protocol negotiation fails ✗

---

## Quick Diagnosis

### 1. **Port Number Issue (MOST LIKELY)**

Your PLC might not be running SLMP on port **1025**.

**Standard SLMP Ports:**
- **5000** = SLMP Binary (default, faster)
- **5006** = SLMP ASCII (text-based)
- **1025** = Usually NOT SLMP (might be Modbus TCP or custom protocol)

**Action:**
1. In Machine page → PLC Communication tab
2. Change **Port** from `1025` to `5000` or `5006`
3. Set **Frame Mode** to explicit `BINARY` or `ASCII` (not AUTO)
4. Click **Test Registers** again

**How to verify correct port on PLC:**
- Check PLC network settings / communication config
- Look for "SLMP" or "Mitsubishi" communication protocol
- Port assignment in PLC parameter

---

### 2. **Frame Mode / Protocol Mismatch**

Even if port is correct, the frame format must match PLC config.

**Current Issue Flow:**
```
Machine.jsx → readPlcRegisters()
    ↓
Backend plcIoService.js → readSlmpRegisters()
    ↓
Socket connects to IP:Port ✓
    ↓
Send SLMP frame (BINARY or ASCII)
    ↓
PLC doesn't recognize protocol ✗ → TIMEOUT
```

**Fix:**
```
Machine page: Protocol = SLMP
            Frame Mode = BINARY (try this first)
                        OR ASCII
                        (NOT AUTO if already failing)
            Device = D (usually correct)
```

---

### 3. **Route / Unit ID Mismatch**

SLMP uses addressing parameters that must match PLC network config.

**Check these environment variables (or defaults):**
```env
PLC_SLMP_NETWORK_NO=0          # Usually 0
PLC_SLMP_PLC_NO=0xff           # Try 0xff or 0
PLC_SLMP_IO_NO=0x03ff          # Q/L series default
PLC_SLMP_STATION_NO=0          # Usually 0
```

**Typical working values:**
- networkNo: 0
- plcNo: 0xff (broadcast) or 0 (direct)
- ioNo: 0x03ff (Q/L) or 0x03d0 (iQ-R)
- stationNo: 0

**If mismatch:** You'll get "SLMP end code" errors instead of timeout

---

### 4. **PLC SLMP Service Not Enabled**

**Verify on PLC:**
1. Check communication module is enabled
2. SLMP service/protocol is active
3. Correct network interface is listening
4. Firewall/security settings allow port access

---

## Testing Strategy

### Step 1: Test Backend Directly
```bash
cd backend
node check-plc-connection.js
```

This tests all combinations:
- SLMP BINARY on 1025
- SLMP ASCII on 1025
- Modbus TCP on 1025
- SLMP BINARY on 5000

**Expected output:**
```
--- Testing SLMP Binary on 192.168.119.40:1025 ---
SLMP BINARY Success: { values: {...} }
```

If all fail: **Network/Port issue**
If 5000 succeeds: **Use port 5000 in Machine page**

---

### Step 2: Manual Register Read Test

**In Machine page:**
1. Protocol: `SLMP`
2. IP: `192.168.119.40`
3. Port: `5000` (try this first)
4. Frame Mode: `BINARY`
5. Device: `D`
6. Add Test Register: `2250` (or any D register you know exists)
7. Click **Test Registers**

**Expected:**
- Success: Shows register value ✓
- Timeout: Port/protocol wrong, go back to Step 1
- Error "end code": Route/unit ID mismatch, adjust PLC settings

---

### Step 3: Verify Configuration

Print current settings:
```bash
# In backend, check env:
echo $PLC_SLMP_NETWORK_NO
echo $PLC_SLMP_PLC_NO
echo $PLC_SLMP_IO_NO
echo $PLC_SLMP_STATION_NO
```

---

## Error Messages Explained

| Error | Meaning | Fix |
|-------|---------|-----|
| `PLC packet timeout` | No response on port | Wrong port or protocol not enabled on PLC |
| `SLMP end code 0xXXXX` | Bad route/unit ID | Adjust networkNo/plcNo/ioNo/stationNo |
| `econnrefused` | Connection refused | Port is not open / firewall blocked |
| `Socket hang up` | PLC hung up connection | PLC busy, overloaded, or protocol not supported |
| `Invalid SLMP response` | Corrupt data received | Frame mode mismatch (BINARY vs ASCII) |

---

## Recommended Settings for Common PLC Models

### Mitsubishi Q/L Series
```
Protocol:  SLMP
Port:      5000
Frame:     BINARY
Device:    D
Route:     networkNo=0, plcNo=0xff, ioNo=0x03ff, stationNo=0
```

### Mitsubishi iQ-R Series
```
Protocol:  SLMP
Port:      5000
Frame:     BINARY
Device:    D
Route:     networkNo=0, plcNo=0xff, ioNo=0x03d0, stationNo=0
```

### Generic Modbus Gateway
```
Protocol:  MODBUS_TCP
Port:      502 (or configured on gateway)
Frame:     N/A
Unit ID:   1 (or configured)
```

---

## QR Scanning Improvements ✓

The following messages are now user-friendly:

| Scenario | New Message |
|----------|------------|
| Duplicate scan | ✓ Already completed. Part passed. Ready for next scan. |
| Wrong format | ❌ QR format mismatch. Invalid component code. |
| Part not found | ❌ Part not found. Verify QR code. |
| Previous station incomplete | ⚠ Previous station not completed. Process parts through earlier stations. |
| Machine running | ⏳ Machine is running. Wait for cycle complete. |
| First scan loading | Shows "Scanning..." instead of error type |

---

## Next Steps

1. **Immediate:** Change port to `5000` and test again
2. **If still failing:** Run `node backend/check-plc-connection.js`
3. **If that works:** Compare successful settings with Machine page config
4. **If none work:** Check PLC network configuration and enable SLMP service

---

## Support

For detailed logs, enable backend debug:
```bash
export DEBUG=plc:*
npm start
```

This will show all SLMP frame details and help identify exact protocol issue.
