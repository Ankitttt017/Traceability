/**
 * IndusTrace Backend — server.js
 * ─────────────────────────────────────────────────────────────────
 * Socket.IO Events Emitted by this Server:
 *
 * [Realtime / Scan]
 *   dashboard_refresh      — triggers UI reload
 *   machine_status         — array of machine states (5s poll)
 *   scanner_status         — array of scanner states (5s poll)
 *   scan_event             — new scan processed { partId, machineId, status }
 *   plc_connection_event   — PLC handshake lifecycle { machineId, state, attempt }
 *   plc_circuit_event      — circuit breaker state { machineId, state, openUntil }
 *
 * [Alarms — Upgrade 6]
 *   alarm:ng_rate          — NG rate exceeded 10% { machineId, ngRate, totalCount }
 *   alarm:silent           — Machine silent > 10min { machineId, lastScanTime }
 *   alarm:plc_disconnect   — PLC socket lost { machineId, ip, port, errorMessage }
 *
 * [PLC Write Retry — Upgrade 3]
 *   plc:write_failed       — PLC write exhausted retries { machineId, operation, payload }
 *
 * [Offline Buffer — Upgrade 4]
 *   db:offline             — DB unreachable, buffering locally { count }
 *   db:reconnected         — DB back, replaying buffer { replayed, failed }
 * ─────────────────────────────────────────────────────────────────
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const sequelize = require("./config/db");
const { errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const v1Routes = require("./routes/v1");
const Machine = require("./models/Machine");
const Scanner = require("./models/Scanner");
const User = require("./models/User");
const Shift = require("./models/Shift");
require("./models/Part");
require("./models/OperationLog");
require("./models/ProductionLog");
require("./models/QrFormatRule");
require("./models/ReworkLog");
require("./models/PackingSession");
require("./models/PackingItem");
require("./models/PackingManagementSetting");
require("./models/StationFeatureSetting");
require("./models/RoleAccessSetting");
require("./models/PlcRegisterRange");
require("./models/ScannerConnection");
const { getPartRoom, setSocketServer } = require("./services/realtimeService");
const { startPlcHealthMonitor } = require("./services/plcHealthService");
const { resetAllMachineLocks } = require("./services/machineLockService");
const scannerService = require("./services/scannerConnectionService");
const { startAlarmMonitor } = require("./services/alarmService");

require("./tcp/tcpServer");
require("./models/AuditLog"); // UPGRADE 5 — auto-sync AuditLog table
require("./models/Alarm");    // UPGRADE 6 — auto-sync Alarms table

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
  path: "/socket.io/",
});
setSocketServer(io);

app.use(cors());
app.use(express.json());

const { getAuditLog } = require("./controllers/auditController");
// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", v1Routes);
app.use("/api", v1Routes);
// Upgrade 5 — Audit Log route (Admin only, JWT auth required via v1Routes middleware)
app.get("/api/audit", getAuditLog);
app.get("/api/v1/audit", getAuditLog);

app.get("/", (_req, res) => {
  res.send("Traceability Backend Running");
});

app.use(errorHandler);

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("subscribe_part", (payload = {}) => {
    const partId = typeof payload === "string" ? payload : payload.partId;
    const room = getPartRoom(partId);
    if (room) {
      socket.join(room);
    }
  });

  socket.on("unsubscribe_part", (payload = {}) => {
    const partId = typeof payload === "string" ? payload : payload.partId;
    const room = getPartRoom(partId);
    if (room) {
      socket.leave(room);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Moved to startServer after sync

async function ensureDefaultAdminUser() {
  const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";
  const defaultRole = process.env.DEFAULT_ADMIN_ROLE || "Admin";

  const existingUser = await User.findOne({ where: { username: defaultUsername } });
  if (existingUser) {
    return;
  }

  await User.create({
    username: defaultUsername,
    password: defaultPassword,
    role: defaultRole,
    status: "ACTIVE",
  });

  console.log(`Default user created: ${defaultUsername} (${defaultRole})`);
}

async function ensureDefaultShifts() {
  const defaults = [
    { shift_name: "Shift A", shift_code: "SHIFT_A", start_time: "06:00:00", end_time: "14:00:00", is_active: true },
    { shift_name: "Shift B", shift_code: "SHIFT_B", start_time: "14:00:00", end_time: "22:00:00", is_active: true },
    { shift_name: "Shift C", shift_code: "SHIFT_C", start_time: "22:00:00", end_time: "06:00:00", is_active: true },
  ];

  for (const shift of defaults) {
    const existing = await Shift.findOne({ where: { shift_code: shift.shift_code } });
    if (!existing) {
      await Shift.create(shift);
    }
  }
}

const PORT = process.env.PORT || 4000;
// Keep schema auto-alter OFF by default in dev runtime.
// Repeated alter on some MySQL setups can create excessive keys/index attempts.
const syncAlter = process.env.DB_SYNC_ALTER === "true";
const syncForce = process.env.DB_SYNC_FORCE === "true";
const dbSetupMode = process.env.DB_SETUP_MODE === "true";

function collectSqlErrorMessages(error) {
  const innerErrors = [
    ...(error?.parent?.errors || []),
    ...(error?.original?.errors || []),
  ];

  return [
    error?.message,
    error?.parent?.message,
    error?.original?.message,
    ...innerErrors.map((entry) => entry?.message),
  ]
    .filter(Boolean)
    .map((message) => String(message));
}

function isSqlPermissionDenied(error) {
  const combined = collectSqlErrorMessages(error).join(" | ").toLowerCase();
  return combined.includes("permission was denied");
}

function isMssqlAlterUniqueSyntaxError(error) {
  const combined = collectSqlErrorMessages(error).join(" | ").toLowerCase();
  const sqlText = String(error?.sql || error?.parent?.sql || error?.original?.sql || "").toLowerCase();
  return (
    combined.includes("incorrect syntax near the keyword 'unique'") &&
    sqlText.includes("alter table")
  );
}

async function runStartupDbTask(label, taskFn) {
  try {
    await taskFn();
  } catch (error) {
    if (dbSetupMode && isSqlPermissionDenied(error)) {
      console.warn(`[Startup][DB_SETUP_MODE] Skipping ${label}: permission denied.`);
      return;
    }
    throw error;
  }
}

async function startServer() {
  try {
    await sequelize.authenticate();
    try {
      await sequelize.sync({ alter: syncAlter, force: syncForce });
    } catch (syncError) {
      const isMssql = sequelize.getDialect && sequelize.getDialect() === "mssql";
      if (isMssql && syncAlter && !syncForce && isMssqlAlterUniqueSyntaxError(syncError)) {
        console.warn("[Startup] MSSQL alter sync hit UNIQUE syntax issue; retrying with alter=false.");
        await sequelize.sync({ alter: false, force: false });
      } else {
        throw syncError;
      }
    }
    await runStartupDbTask("resetAllMachineLocks", () => resetAllMachineLocks());
    await runStartupDbTask("resetAllScannerConnectionStates", () => scannerService.resetAllScannerConnectionStates());
    await runStartupDbTask("ensureDefaultAdminUser", () => ensureDefaultAdminUser());
    await runStartupDbTask("ensureDefaultShifts", () => ensureDefaultShifts());

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      startPlcHealthMonitor();
      startAlarmMonitor();

      // Start the status update interval after sync
      setInterval(async () => {
        try {
          const [machines, scanners] = await Promise.all([
            Machine.findAll({ order: [["sequence_no", "ASC"]] }),
            Scanner.findAll({ where: { is_active: true } }),
          ]);
          io.emit(
            "machine_status",
            machines.map((machine) => ({
              ...machine.toJSON(),
            }))
          );
          io.emit(
            "scanner_status",
            scanners.map((scanner) => scanner.toJSON())
          );
        } catch (error) {
          console.error("Socket error:", error);
        }
      }, 5000);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
