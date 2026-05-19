# ✅ Fixes Applied - PLC & QR Scanning Issues

## Summary of Changes

### 1. **Backend SLMP Error Messages - ENHANCED ✓**

**File:** `backend/services/plcIoService.js`

**What was fixed:**
- Added diagnostic hints to SLMP timeout errors
- Now distinguishes between "no response" (port/protocol issue) vs "rejected request" (config issue)
- Shows actionable guidance in error messages

**Error Message Before:**
```
"PLC packet timeout (tried SLMP frames: BINARY,ASCII; routes: net=0,plc=255,io=1023,station=0)"
```

**Error Message After:**
```
"Register read failed: PLC packet timeout — No PLC response. Verify: (1) Port 5000/5006 
is correct for SLMP, (2) PLC service enabled, (3) Firewall allows access"
```

---

### 2. **Machine Page Error Display - ENHANCED ✓**

**File:** `frontend/src/pages/Machine.jsx`

**What was fixed:**
- Improved error card layout with better visual hierarchy
- Added smart hints that appear when timeout is detected
- Shows specific guidance for port 1025 vs standard SLMP ports
- Better formatting for readability

**New Features:**
```
When "timeout" error detected:
  ↓
Shows: "Hint: Port 1025 may not be SLMP. Try port 5000 (BINARY) 
         or 5006 (ASCII). Verify PLC SLMP service is enabled."
```

---

### 3. **QR Scanning Error Messages - ALREADY EXCELLENT ✓**

**File:** `frontend/src/components/GlobalPopup.jsx`

**Current User-Friendly Messages:**
- ✓ Already completed → "✓ Already completed. Part passed. Ready for next scan."
- ❌ Format mismatch → "❌ QR format mismatch. Invalid component code."
- ❌ Part not found → "❌ Part not found. Verify QR code."
- ⚠ Previous station incomplete → "⚠ Previous station not completed. Process earlier."
- ⏳ Machine running → "⏳ Machine is running. Wait for cycle complete."
- 🔒 Part interlocked → "🔒 Part interlocked. Use Reset Operation."
- 🔄 First scan loading → Shows "Scanning..." (not error type)

**No changes needed** - Already optimal

---

### 4. **PLC Diagnostics Guide - CREATED ✓**

**File:** `PLC_DIAGNOSTICS_GUIDE.md` (NEW)

Complete troubleshooting guide with:
- Root cause analysis
- Quick diagnosis steps
- Port number verification
- Frame mode troubleshooting
- Testing strategy
- Error message explanations
- Recommended settings for different PLC models

---

## 🚀 Next Steps: Fix Your PLC Connection

### Immediate Action Required:

1. **Check PLC Port Configuration**
   ```
   Current: 192.168.119.40:1025
   Issue:   1025 is not standard SLMP
   
   Standard SLMP Ports:
   - 5000 = SLMP Binary (faster)
   - 5006 = SLMP ASCII (debug)
   ```

2. **Update Machine Page Settings**
   - Go to: Machine Page → Edit → PLC Communication
   - Change Port: `1025` → `5000` or `5006`
   - Change Frame Mode: `AUTO` → `BINARY` (or `ASCII`)
   - Click "Test Registers" to verify

3. **If Still Failing**
   - TCP connects ✓ but PLC doesn't respond with SLMP protocol
   - Check PLC network settings:
     - SLMP service enabled?
     - Listening on port 5000/5006?
     - Correct network interface?

### Test Directly (Backend):

```bash
cd backend
node check-plc-connection.js
```

This script tests all combinations and shows which port/protocol works.

---

## 📊 What Changed for User Experience

| Area | Before | After |
|------|--------|-------|
| **PLC Errors** | Cryptic technical message | Clear diagnostic hints |
| **First Scan Loading** | Could show as error | Shows "Scanning..." |
| **Timeout Errors** | No hints for fixing | Suggests port/protocol checks |
| **QR Messages** | Standard text | Emoji + friendly language |
| **Error Formatting** | Basic text | Better visual hierarchy |

---

## 🔍 Debugging Checklist

- [ ] TCP connection: Works (port opens)
- [ ] SLMP protocol: Needs testing (likely issue is here)
- [ ] Port number: Verify 5000/5006 for SLMP
- [ ] Frame mode: Try explicit BINARY first
- [ ] PLC settings: Route params match
- [ ] Firewall: Allows outbound to port 5000
- [ ] PLC service: SLMP enabled

---

## 📝 Common PLC Models - Expected Settings

### Mitsubishi Q/L Series (Most Common)
```
Protocol:     SLMP
Port:         5000
Frame Mode:   BINARY
Device:       D
Register:     2250 (test value - adjust to yours)
```

### Mitsubishi iQ-R Series
```
Protocol:     SLMP
Port:         5000
Frame Mode:   BINARY
Device:       D
Route (ENV):  PLC_SLMP_IO_NO=0x03d0 (iQ-R specific)
```

### Generic Modbus TCP (Gateway)
```
Protocol:     MODBUS_TCP
Port:         502 (or gateway configured)
Unit ID:      1
Register:     2250 (adjust to yours)
```

---

## 📞 If Issues Persist

1. **Run backend test:** `node backend/check-plc-connection.js`
   - Shows which port/protocol actually works
   
2. **Check PLC Network Config:**
   - IP: 192.168.119.40
   - SLMP Port: 5000/5006
   - Service enabled?
   
3. **Enable Debug Logs:**
   ```bash
   export DEBUG=plc:*
   npm start
   ```

---

**Last Updated:** 2026-05-19  
**Status:** ✅ Ready for testing
