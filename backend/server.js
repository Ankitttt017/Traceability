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
const rejectionConfigRoutes = require("./routes/v1/rejectionConfigRoutes");
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
require("./models/Plant");
require("./models/Line");
require("./models/LinePartAssignment");
require("./models/RoleAccessSetting");
require("./models/PlcRegisterRange");
require("./models/ScannerConnection");
require("./models/PartCodeMapping");
require("./models/RejectionCategory");
require("./models/RejectionReason");
require("./models/RejectionView");
require("./models/RejectionZone");
require("./models/RejectionSubZone");
require("./models/RejectionZoneReason");
const { getPartRoom, setSocketServer } = require("./services/realtimeService");
const { resetAllMachineLocks } = require("./services/machineLockService");
const scannerService = require("./services/scannerConnectionService");
const { startAlarmMonitor } = require("./services/alarmService");
const {
  ensureMachineQrScannerUniqueness,
  ensurePerformanceColumnsExist,
  ensureTraceabilityColumnsExist,
  ensureScannerColumnsExist,
  ensureScannerIpCanBeShared,
  ensurePlcLinkColumnsExist,
  ensureRoleAccessSchema,
  ensureUserRoleSchema,
  ensureRejectionSchema,
  ensureDatabasePerformanceIndexes,
} = require("./services/machineSchemaService");
const { runStartupRecovery } = require("./services/startupRecoveryService");
const {
  initializeIndustrialServices,
  retrySkippedDbDependentServices,
  shutdownIndustrialServices,
  getServiceRegistry,
  getStartupStatus,
} = require("./services/industrialStartupManager");
const {
  refreshIndustrialCaches,
  getIndustrialCaches,
  setDbAvailabilityState,
  warnOnce,
} = require("./services/industrialConfigCacheService");

const { startTcpServer, shutdownTcpServer } = require("./tcp/tcpServer");
const { ensureDefaultOrganization, ensureLinePartAssignmentSchema } = require("./services/organizationService");
require("./models/AuditLog"); // UPGRADE 5 — auto-sync AuditLog table
require("./models/Alarm");    // UPGRADE 6 — auto-sync Alarms table

const app = express();
const server = http.createServer(app);
server.timeout = 180000; // 3 min — allow large date-range report queries to complete
server.keepAliveTimeout = 65000;
const io = new Server(server, {
  cors: {
    origin: "*",
  },
  path: "/socket.io/",
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 30000,
  pingInterval: 25000,
  connectTimeout: 15000,
});
setSocketServer(io);

const corsOptions = {
  origin: true,
  credentials: false,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
};
app.use(cors(corsOptions));
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

const { getAuditLog } = require("./controllers/auditController");
// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/rejection-config", rejectionConfigRoutes);
app.use("/api/rejection-config", rejectionConfigRoutes);
app.use("/api/v1", v1Routes);
app.use("/api", v1Routes);
// Upgrade 5 — Audit Log route (Admin only, JWT auth required via v1Routes middleware)
app.get("/api/audit", getAuditLog);
app.get("/api/v1/audit", getAuditLog);

app.get("/", (_req, res) => {
  res.send("Traceability Backend Running");
});
app.get("/health/industrial", (_req, res) => {
  const cacheState = getIndustrialCaches();
  return res.json({
    ok: true,
    dbAvailable,
    degradedMode: !dbAvailable,
    reconnectIntervalMs,
    lastDbCheckAt,
    lastSuccessfulDbConnectAt,
    cache: cacheState,
    serviceRegistry: getServiceRegistry(),
    timestamp: new Date().toISOString(),
  });
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
  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin@123";
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

const PORT = process.env.PORT || 3000;
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

let statusEmitterTimerRef = null;
let shuttingDown = false;
let statusEmitterRunning = false;
let lastStatusEmitterDbErrorAt = 0;
const STATUS_EMITTER_DB_ERROR_THROTTLE_MS = 60 * 1000;
let dbAvailable = false;
let dbReconnectTimerRef = null;
let reconnectIntervalMs = 30000;
let lastDbCheckAt = null;
let lastSuccessfulDbConnectAt = null;
const DEGRADED_RECONNECT_MS = 10000;
const STABLE_RECONNECT_MS = 30000;

function stopStatusEmitter() {
  if (statusEmitterTimerRef) {
    clearTimeout(statusEmitterTimerRef);
    statusEmitterTimerRef = null;
  }
}

function scheduleStatusEmitter() {
  stopStatusEmitter();
  statusEmitterTimerRef = setTimeout(async () => {
    if (statusEmitterRunning) {
      if (!shuttingDown) {
        scheduleStatusEmitter();
      }
      return;
    }
    statusEmitterRunning = true;
    try {
      if (dbAvailable) {
        await refreshIndustrialCaches();
      }
      const { machinesCache, scannersCache } = getIndustrialCaches();
      io.emit("machine_status", machinesCache || []);
      io.emit("scanner_status", scannersCache || []);
    } catch (error) {
      const now = Date.now();
      const isDbConnError =
        String(error?.name || "").includes("SequelizeConnectionError") ||
        String(error?.parent?.code || "").toUpperCase() === "ESOCKET" ||
        String(error?.parent?.code || "").toUpperCase() === "ETIMEOUT" ||
        String(error?.original?.code || "").toUpperCase() === "ETIMEOUT" ||
        String(error?.name || "").includes("AggregateError");
      if (isDbConnError) {
        if (now - lastStatusEmitterDbErrorAt >= STATUS_EMITTER_DB_ERROR_THROTTLE_MS) {
          lastStatusEmitterDbErrorAt = now;
          warnOnce("socket_status_db_issue", `[SocketStatus] DB connection issue while emitting status; will retry. ${error?.message || ""}`, STATUS_EMITTER_DB_ERROR_THROTTLE_MS);
        }
      } else {
        console.error("Socket status emitter error:", error);
      }
    } finally {
      statusEmitterRunning = false;
      if (!shuttingDown) {
        scheduleStatusEmitter();
      }
    }
  }, 5000);
}

function stopDbReconnectLoop() {
  if (dbReconnectTimerRef) {
    clearTimeout(dbReconnectTimerRef);
    dbReconnectTimerRef = null;
  }
}

function scheduleDbReconnectLoop(delayMs = 30000) {
  stopDbReconnectLoop();
  reconnectIntervalMs = Math.max(5000, Number(delayMs || STABLE_RECONNECT_MS));
  dbReconnectTimerRef = setTimeout(async () => {
    if (shuttingDown) return;
    lastDbCheckAt = new Date().toISOString();
    try {
      await sequelize.authenticate();
      const wasUnavailable = !dbAvailable;
      dbAvailable = true;
      setDbAvailabilityState(true);
      lastSuccessfulDbConnectAt = new Date().toISOString();
      if (wasUnavailable) {
        console.log("[Startup] DB reconnected. Reloading industrial caches/config.");
        io.emit("db:reconnected", { timestamp: new Date().toISOString() });
      }
      await refreshIndustrialCaches();
      const recoveredRegistry = await retrySkippedDbDependentServices({ dbAvailable: true });
      io.emit("industrial:services:recovered", {
        timestamp: new Date().toISOString(),
        serviceRegistry: recoveredRegistry,
      });
      reconnectIntervalMs = STABLE_RECONNECT_MS;
    } catch (error) {
      dbAvailable = false;
      setDbAvailabilityState(false);
      reconnectIntervalMs = DEGRADED_RECONNECT_MS;
      const now = Date.now();
      if (now - lastStatusEmitterDbErrorAt >= STATUS_EMITTER_DB_ERROR_THROTTLE_MS) {
        lastStatusEmitterDbErrorAt = now;
        warnOnce("db_reconnect_failed", `[Startup] DB reconnect attempt failed: ${error?.message || "unknown error"}`, STATUS_EMITTER_DB_ERROR_THROTTLE_MS);
      }
      io.emit("db:offline", { timestamp: new Date().toISOString(), reason: "DB_RECONNECTING" });
    } finally {
      if (!shuttingDown) scheduleDbReconnectLoop(reconnectIntervalMs);
    }
  }, reconnectIntervalMs);
}

async function performGracefulShutdown(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[Shutdown] Received ${signal}. Stopping industrial services...`);

  stopStatusEmitter();
  stopDbReconnectLoop();

  try {
    await shutdownIndustrialServices();
    await shutdownTcpServer();
  } catch (error) {
    console.error("[Shutdown] industrial service shutdown failed:", error.message);
  }

  await new Promise((resolve) => {
    server.close(() => resolve());
  });

  try {
    await sequelize.close();
  } catch (_error) {
    // noop
  }

  process.exit(0);
}

async function startServer() {
  let httpStarted = false;
  try {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      startAlarmMonitor();
      scheduleStatusEmitter();
      io.emit("db:offline", { timestamp: new Date().toISOString(), reason: "DB_RECONNECTING" });
    });
    httpStarted = true;

    let startupDbAvailable = false;
    lastDbCheckAt = new Date().toISOString();
    try {
      await sequelize.authenticate();
      startupDbAvailable = true;
      dbAvailable = true;
      setDbAvailabilityState(true);
      lastSuccessfulDbConnectAt = new Date().toISOString();
      io.emit("db:connected", { timestamp: new Date().toISOString() });
    } catch (_err) {
      startupDbAvailable = false;
      dbAvailable = false;
      setDbAvailabilityState(false);
      io.emit("db:offline", { timestamp: new Date().toISOString(), reason: "DB_STARTUP_UNAVAILABLE" });
    }

    await initializeIndustrialServices({ dbAvailable: startupDbAvailable });
    startTcpServer();
    const startup = getStartupStatus();
    console.log(`[Startup] Industrial services initialized: ${startup.serviceCount}`);
    if (startupDbAvailable) {
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
      await runStartupDbTask("ensurePerformanceColumnsExist", () => ensurePerformanceColumnsExist());
      await runStartupDbTask("ensureTraceabilityColumnsExist", () => ensureTraceabilityColumnsExist());
      await runStartupDbTask("ensureScannerColumnsExist", () => ensureScannerColumnsExist());
      await runStartupDbTask("ensureScannerIpCanBeShared", () => ensureScannerIpCanBeShared());
      await runStartupDbTask("ensurePlcLinkColumnsExist", () => ensurePlcLinkColumnsExist());
      await runStartupDbTask("ensureRoleAccessSchema", () => ensureRoleAccessSchema());
      await runStartupDbTask("ensureUserRoleSchema", () => ensureUserRoleSchema());
      await runStartupDbTask("ensureRejectionSchema", () => ensureRejectionSchema());
      await runStartupDbTask("ensureDatabasePerformanceIndexes", () => ensureDatabasePerformanceIndexes());
      await runStartupDbTask("ensureDefaultOrganization", () => ensureDefaultOrganization());
      await runStartupDbTask("ensureLinePartAssignmentSchema", () => ensureLinePartAssignmentSchema());
      await runStartupDbTask("ensureMachineQrScannerUniqueness", () => ensureMachineQrScannerUniqueness());
      await runStartupDbTask("resetAllMachineLocks", () => resetAllMachineLocks());
      await runStartupDbTask("resetAllScannerConnectionStates", () => scannerService.resetAllScannerConnectionStates());
      await runStartupDbTask("runStartupRecovery", () => runStartupRecovery());
      await runStartupDbTask("ensureDefaultAdminUser", () => ensureDefaultAdminUser());
      await runStartupDbTask("ensureDefaultShifts", () => ensureDefaultShifts());
      await refreshIndustrialCaches();
      io.emit("db:connected", { timestamp: new Date().toISOString() });
      scheduleDbReconnectLoop(STABLE_RECONNECT_MS);
    } else {
      scheduleDbReconnectLoop(DEGRADED_RECONNECT_MS);
    }

    process.once("SIGINT", () => {
      performGracefulShutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
      performGracefulShutdown("SIGTERM");
    });
    process.once("SIGHUP", () => {
      performGracefulShutdown("SIGHUP");
    });
  } catch (error) {
    dbAvailable = false;
    setDbAvailabilityState(false);
    console.error("Failed to start server with DB connection:", error?.message || error);
    console.warn("[Startup] Running in degraded mode (DB unavailable). HTTP/TCP/Socket remain active, DB reconnect loop running.");
    if (!httpStarted) {
      server.listen(PORT, () => {
        console.log(`Server running on port ${PORT} (degraded mode, DB unavailable)`);
        startAlarmMonitor();
        scheduleStatusEmitter();
      });
    }
    try {
      startTcpServer();
    } catch (_e) {
      // no-op; TCP may already be started
    }
    scheduleDbReconnectLoop(DEGRADED_RECONNECT_MS);
  }
}

// --- Industrial Runtime Protection ---
process.on("uncaughtException", (error) => {
  console.error("[CRITICAL:UNCAUGHT_EXCEPTION] Server survived an unexpected error:", error);
  // Log details but DO NOT crash the process in production
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL:UNHANDLED_REJECTION] Unhandled promise rejection at:", promise, "reason:", reason);
});

startServer();
