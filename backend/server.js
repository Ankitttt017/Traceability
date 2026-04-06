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

server.listen(PORT, async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: syncAlter });
    await resetAllMachineLocks();
    await scannerService.resetAllScannerConnectionStates();
    await ensureDefaultAdminUser();
    await ensureDefaultShifts();
    startPlcHealthMonitor();
    startAlarmMonitor(); // UPGRADE 6 — start alarm monitor
    console.log(`Server Running on ${PORT}`);
  } catch (error) {
    console.error("Unable to connect to the database:", error);
  }
});
