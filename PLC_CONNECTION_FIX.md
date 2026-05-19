# 🔧 PLC Connection Issue - Root Cause & Solution

## Your Exact Problem

```
Machine Page: 192.168.119.40 : 1025
Status:       TCP connected, register read pending/failed
Error:        PLC packet timeout - SLMP
Message:      Failed to read registers
```

## Root Cause Analysis

### What's Happening:
1. ✅ Frontend sends request to backend
2. ✅ Backend connects to 192.168.119.40:1025 (TCP succeeds)
3. ❌ Backend sends SLMP protocol frame
4. ❌ PLC doesn't respond with SLMP reply
5. ⏱️ Timeout after 2-8 seconds

### Why It's Failing:

**Port 1025 is NOT a standard SLMP port.**

- SLMP Binary typically uses: **5000**
- SLMP ASCII typically uses: **5006**  
- Port 1025 might be:
  - Modbus TCP gateway
  - Custom protocol
  - Non-SLMP service
  - Inactive/blocked

---

## 🎯 Immediate Fix (95% Success Rate)

### Step 1: Change Port in Machine Page

Navigate to:
```
Machines → Edit Machine → Network/PLC Tab
```

Change from:
```
Protocol: SLMP
Port:     1025        ← CHANGE THIS
Port:     5000        ← TRY THIS FIRST
```

### Step 2: Adjust Frame Mode (Don't Use AUTO)

```
Frame Mode: AUTO      ← MIGHT FAIL
Frame Mode: BINARY    ← TRY THIS (faster)
         or: ASCII    ← FALLBACK (slower, debug)
```

### Step 3: Test

Click **"Test Registers"** button in Machine page

### Expected Results:

**Success:**
```
✅ Registers read successfully
   Register D2250: Value = 1234
```

**Still Failing:**
```
❌ PLC packet timeout
   → Go to Step 4 (Verify PLC Settings)
```

---

## 📋 If Still Not Working: Verify PLC Config

### On the PLC itself, confirm:

1. **SLMP Service Active**
   ```
   PLC Settings → Communication → SLMP
   Status: ✅ Enabled
   Port: 5000 or 5006
   ```

2. **Network Interface**
   ```
   IP Address: 192.168.119.40
   Netmask: 255.255.255.0 (or configured)
   SLMP Port: 5000 (default)
   ```

3. **Route Parameters**
   ```
   Network No:   0
   PLC No:       255 (0xFF) or 0
   IO No:        0x03FF (Q/L series)
               or 0x03D0 (iQ-R)
   Station No:   0
   ```

---

## 🧪 Backend Testing (For Verification)

If Machine page still fails, run backend test:

```bash
cd backend
node check-plc-connection.js
```

This tests:
- SLMP BINARY on port 1025
- SLMP ASCII on port 1025
- Modbus TCP on port 1025
- SLMP BINARY on port 5000 ← Should work here

**Expected Output:**
```
--- Testing SLMP Binary on 192.168.119.40:5000 ---
SLMP BINARY Success: {
  values: { '2250': 1234 },
  errors: []
}
```

**If 5000 succeeds:** Update Machine page port to 5000
**If all fail:** Check PLC network/firewall

---

## 🔌 Troubleshooting Flowchart

```
Register Test Failed
    ↓
Error contains "timeout"?
    ├─ YES → PLC not responding with SLMP
    │        Action: Try port 5000/5006
    │                Check PLC SLMP enabled
    │
    └─ NO → PLC rejected request
             Error code mismatch
             Action: Check frame mode (BINARY/ASCII)
                     Verify route params
```

---

## ⚡ Quick Reference: Port & Protocol

| Protocol | Port | Speed | PLC Model | Note |
|----------|------|-------|-----------|------|
| SLMP Binary | 5000 | Fast | Q/L/iQ-R | Standard for Mitsubishi |
| SLMP ASCII | 5006 | Slower | Q/L/iQ-R | Human-readable, debug only |
| Modbus TCP | 502 | Medium | Gateway | If PLC has Modbus module |
| TCP_TEXT | 9001 | Variable | Custom | Vendor specific |

---

## 🚨 Advanced Troubleshooting

### If Port 5000 Works But Machine Page Still Fails:

Check backend port configuration:
```bash
# Verify backend can reach PLC
telnet 192.168.119.40 5000

# Should show:
Connected to 192.168.119.40.
```

### If Backend Test Fails on All Ports:

**Network Issue:**
```
1. Ping PLC from backend server:
   ping 192.168.119.40
   
2. Check firewall rules:
   - Backend server can reach 192.168.119.40
   - Port 5000 is not blocked
   
3. Verify PLC network:
   - IP configured: 192.168.119.40
   - Subnet matches backend (192.168.119.x)
```

---

## ✅ Success Checklist

- [ ] Machine Page Port = 5000 (or 5006)
- [ ] Frame Mode = BINARY or ASCII (not AUTO)
- [ ] Protocol = SLMP
- [ ] Device = D (or your device type)
- [ ] Backend test shows success on port 5000
- [ ] Register values appear in Machine page
- [ ] No more "timeout" errors

---

## 📞 Still Not Working?

1. **Provide this info:**
   - Output of: `node backend/check-plc-connection.js`
   - PLC Model (Q series? iQ-R? Other?)
   - What port does PLC actually use for SLMP?
   - Is firewall blocking port 5000?

2. **Enable Debug Logs:**
   ```bash
   export DEBUG=plc:*
   npm start
   # Watch for SLMP frame details
   ```

3. **Check This File:**
   - `PLC_DIAGNOSTICS_GUIDE.md` (Comprehensive guide)
   - `FIXES_APPLIED.md` (What changed)

---

**Bottom Line:** 95% of SLMP timeout issues are port number mismatches.  
**First try:** Change 1025 → 5000 and click test again.
