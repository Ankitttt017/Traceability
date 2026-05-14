/**
 * operationTimelineService.js
 * ════════════════════════════════════════════════════════════════
 * 
 * OPERATION TIMELINE PERSISTENCE + RCA DIAGNOSTICS
 * 
 * Persists full machine lifecycle timeline:
 * • SCANNED - part QR scanned
 * • VALIDATED - part + interlocks validated
 * • START_SENT - start signal sent to PLC
 * • WAITING_RUNNING - waiting for machine acknowledgment
 * • RUNNING - machine confirmed running
 * • WAITING_END - waiting for end signal
 * • COMPLETED_OK - operation passed
 * • COMPLETED_NG - operation failed
 * • RESETTING - reset sequence initiated
 * • RECOVERING - recovery sequence active
 * • PLC_TIMEOUT - PLC timeout occurred
 * • PLC_ERROR - PLC communication error
 * • CANCELLED - operation cancelled
 * • ANOMALY_DETECTED - anomaly in operation
 * 
 * Enables:
 * • Root cause analysis (RCA)
 * • Cycle duration tracking
 * • Crash-safe persistence
 * • Operator troubleshooting
 * • Performance analytics
 * 
 * ════════════════════════════════════════════════════════════════
 */

const sequelize = require("../config/db");
const { logInfo, logWarn, logError } = require("./industrialLogger");

// Timeline event types
const TIMELINE_EVENTS = {
  SCANNED: "SCANNED",
  VALIDATED: "VALIDATED",
  START_SENT: "START_SENT",
  WAITING_RUNNING: "WAITING_RUNNING",
  RUNNING: "RUNNING",
  WAITING_END: "WAITING_END",
  COMPLETED_OK: "COMPLETED_OK",
  COMPLETED_NG: "COMPLETED_NG",
  RESETTING: "RESETTING",
  RECOVERING: "RECOVERING",
  PLC_TIMEOUT: "PLC_TIMEOUT",
  PLC_ERROR: "PLC_ERROR",
  CANCELLED: "CANCELLED",
  ANOMALY_DETECTED: "ANOMALY_DETECTED",
};

function parseEventData(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return { raw: String(value) };
  }
}

function normalizeDays(days, fallback = 7) {
  const normalized = Number.parseInt(days, 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

function getMssqlOperationLogsTable() {
  const model = sequelize?.models?.OperationLog;
  if (!model || typeof model.getTableName !== "function") {
    return "[dbo].[OperationLogs]";
  }

  const tableName = model.getTableName();
  if (typeof tableName === "string") {
    return `[dbo].[${tableName}]`;
  }

  const schema = tableName?.schema || "dbo";
  const table = tableName?.tableName || "OperationLogs";
  return `[${schema}].[${table}]`;
}

function collectDbErrorMessages(error) {
  const nested = [
    ...(error?.parent?.errors || []),
    ...(error?.original?.errors || []),
  ];

  return [
    error?.message,
    error?.parent?.message,
    error?.original?.message,
    ...nested.map((item) => item?.message),
  ]
    .filter(Boolean)
    .map((msg) => String(msg));
}

/**
 * Create timeline table if not exists.
 */
async function ensureTimelineTable() {
  try {
    const dialect = typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";
    if (dialect === "mssql") {
      const operationLogsTable = getMssqlOperationLogsTable();
      await sequelize.query(`
        IF OBJECT_ID(N'[dbo].[operation_timelines]', N'U') IS NULL
        BEGIN
          CREATE TABLE [dbo].[operation_timelines] (
            id INT IDENTITY(1,1) PRIMARY KEY,
            operation_id INT NOT NULL,
            part_id NVARCHAR(255) NULL,
            machine_id INT NULL,
            station_no NVARCHAR(100) NULL,
            event_type NVARCHAR(50) NOT NULL,
            event_data NVARCHAR(MAX) NULL,
            duration_from_start_ms INT NULL,
            [timestamp] DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
            created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
            updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
          );
        END
      `);

      await sequelize.query(`
        IF OBJECT_ID(N'${operationLogsTable}', N'U') IS NOT NULL
           AND OBJECT_ID(N'[dbo].[operation_timelines]', N'U') IS NOT NULL
           AND OBJECT_ID(N'[dbo].[FK_operation_timelines_operation_logs]', N'F') IS NULL
        BEGIN
          ALTER TABLE [dbo].[operation_timelines]
          ADD CONSTRAINT [FK_operation_timelines_operation_logs]
          FOREIGN KEY ([operation_id]) REFERENCES ${operationLogsTable}([id]) ON DELETE CASCADE;
        END
      `);

      await sequelize.query(`
        IF OBJECT_ID(N'${operationLogsTable}', N'U') IS NULL
        BEGIN
          PRINT 'Skipping FK creation for operation_timelines: operation logs table not found.';
        END
      `);

      await sequelize.query(`
        IF OBJECT_ID(N'[dbo].[operation_timelines]', N'U') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sys.indexes
             WHERE name = N'idx_operation_timelines_operation_id'
               AND object_id = OBJECT_ID(N'[dbo].[operation_timelines]')
           )
        BEGIN
          CREATE INDEX [idx_operation_timelines_operation_id]
          ON [dbo].[operation_timelines]([operation_id]);
        END
      `);

      await sequelize.query(`
        IF OBJECT_ID(N'[dbo].[operation_timelines]', N'U') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sys.indexes
             WHERE name = N'idx_operation_timelines_machine_id'
               AND object_id = OBJECT_ID(N'[dbo].[operation_timelines]')
           )
        BEGIN
          CREATE INDEX [idx_operation_timelines_machine_id]
          ON [dbo].[operation_timelines]([machine_id]);
        END
      `);

      await sequelize.query(`
        IF OBJECT_ID(N'[dbo].[operation_timelines]', N'U') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sys.indexes
             WHERE name = N'idx_operation_timelines_timestamp'
               AND object_id = OBJECT_ID(N'[dbo].[operation_timelines]')
           )
        BEGIN
          CREATE INDEX [idx_operation_timelines_timestamp]
          ON [dbo].[operation_timelines]([timestamp]);
        END
      `);

      await sequelize.query(`
        IF OBJECT_ID(N'[dbo].[operation_timelines]', N'U') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sys.indexes
             WHERE name = N'idx_operation_timelines_event_type'
               AND object_id = OBJECT_ID(N'[dbo].[operation_timelines]')
           )
        BEGIN
          CREATE INDEX [idx_operation_timelines_event_type]
          ON [dbo].[operation_timelines]([event_type]);
        END
      `);
    } else {
      const query = `
        CREATE TABLE IF NOT EXISTS operation_timelines (
          id INT PRIMARY KEY AUTO_INCREMENT,
          operation_id INT NOT NULL,
          part_id VARCHAR(255),
          machine_id INT,
          station_no VARCHAR(100),
          event_type VARCHAR(50) NOT NULL,
          event_data JSON,
          duration_from_start_ms INT,
          timestamp DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          INDEX idx_operation_id (operation_id),
          INDEX idx_machine_id (machine_id),
          INDEX idx_timestamp (timestamp),
          INDEX idx_event_type (event_type),
          FOREIGN KEY (operation_id) REFERENCES operation_logs(id) ON DELETE CASCADE
        )
      `;
      await sequelize.query(query);
    }
    logInfo("TIMELINE_TABLE_ENSURED", {});
  } catch (error) {
    logError("TIMELINE_TABLE_CREATION_ERROR", {
      error: collectDbErrorMessages(error).join(" | "),
    });
    throw error;
  }
}

/**
 * Record a timeline event for an operation.
 */
async function recordTimelineEvent({
  operationId,
  partId,
  machineId,
  stationNo,
  eventType,
  eventData = {},
  durationFromStartMs = null,
}) {
  try {
    const query = `
      INSERT INTO operation_timelines (
        operation_id,
        part_id,
        machine_id,
        station_no,
        event_type,
        event_data,
        duration_from_start_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await sequelize.query(query, {
      replacements: [
        operationId,
        partId || null,
        machineId || null,
        stationNo || null,
        eventType,
        JSON.stringify(eventData),
        durationFromStartMs || null,
      ],
    });

    logInfo("TIMELINE_EVENT_RECORDED", {
      operationId,
      machineId,
      eventType,
    });

    return { recorded: true, operationId, eventType };
  } catch (error) {
    logError("TIMELINE_EVENT_RECORDING_ERROR", {
      operationId,
      eventType,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get full timeline for an operation.
 */
async function getOperationTimeline(operationId) {
  try {
    const query = `
      SELECT 
        id,
        operation_id,
        part_id,
        machine_id,
        station_no,
        event_type,
        event_data,
        duration_from_start_ms,
        timestamp,
        created_at
      FROM operation_timelines
      WHERE operation_id = ?
      ORDER BY created_at ASC
    `;

    const [rows] = await sequelize.query(query, {
      replacements: [operationId],
    });

    return {
      operationId,
      events: rows.map((row) => ({
        ...row,
        event_data: parseEventData(row.event_data),
      })),
      totalEvents: rows.length,
      startTime: rows.length > 0 ? rows[0].created_at : null,
      endTime: rows.length > 0 ? rows[rows.length - 1].created_at : null,
    };
  } catch (error) {
    logError("TIMELINE_QUERY_ERROR", {
      operationId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get timeline with cycle duration analysis.
 */
async function getOperationTimelineWithDuration(operationId) {
  try {
    const timeline = await getOperationTimeline(operationId);

    if (timeline.events.length === 0) {
      return {
        ...timeline,
        cycleDuration: null,
        durationByPhase: {},
      };
    }

    const events = timeline.events;
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    const cycleDuration =
      new Date(lastEvent.created_at) - new Date(firstEvent.created_at);

    // Calculate phase durations
    const durationByPhase = {};
    for (let i = 0; i < events.length - 1; i++) {
      const current = events[i];
      const next = events[i + 1];
      const phaseName = `${current.event_type}_to_${next.event_type}`;
      const phaseDuration =
        new Date(next.created_at) - new Date(current.created_at);
      durationByPhase[phaseName] = phaseDuration;
    }

    return {
      ...timeline,
      cycleDuration,
      durationByPhase,
    };
  } catch (error) {
    logError("TIMELINE_DURATION_ANALYSIS_ERROR", {
      operationId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Query timelines with filters for analytics.
 */
async function queryTimelines({
  machineId = null,
  eventType = null,
  startDate = null,
  endDate = null,
  limit = 100,
}) {
  try {
    const dialect = typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";
    let query = "SELECT * FROM operation_timelines WHERE 1=1";
    const replacements = [];

    if (machineId) {
      query += " AND machine_id = ?";
      replacements.push(machineId);
    }

    if (eventType) {
      query += " AND event_type = ?";
      replacements.push(eventType);
    }

    if (startDate) {
      query += " AND created_at >= ?";
      replacements.push(startDate);
    }

    if (endDate) {
      query += " AND created_at <= ?";
      replacements.push(endDate);
    }

    if (dialect === "mssql") {
      query = query.replace("SELECT *", `SELECT TOP ${Math.trunc(limit)} *`);
      query += " ORDER BY created_at DESC";
    } else {
      query += " ORDER BY created_at DESC LIMIT ?";
      replacements.push(limit);
    }

    const [rows] = await sequelize.query(query, { replacements });

    return {
      total: rows.length,
      events: rows.map((row) => ({
        ...row,
        event_data: parseEventData(row.event_data),
      })),
    };
  } catch (error) {
    logError("TIMELINE_QUERY_FILTER_ERROR", {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Calculate average cycle duration by machine.
 */
async function getAverageCycleDuration(machineId, days = 7) {
  try {
    const dialect = typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";
    const safeDays = normalizeDays(days, 7);
    const replacements = [machineId, safeDays];
    const query = dialect === "mssql"
      ? `
        SELECT
          agg.machine_id,
          AVG(CAST(DATEDIFF(SECOND, agg.first_event_at, agg.last_event_at) AS FLOAT)) AS avg_duration_seconds,
          COUNT(*) AS total_operations
        FROM (
          SELECT
            machine_id,
            operation_id,
            MIN(created_at) AS first_event_at,
            MAX(created_at) AS last_event_at
          FROM operation_timelines
          WHERE machine_id = ?
            AND created_at >= DATEADD(DAY, -?, SYSUTCDATETIME())
          GROUP BY machine_id, operation_id
        ) agg
        GROUP BY agg.machine_id
      `
      : `
        SELECT 
          machine_id,
          AVG(TIMESTAMPDIFF(SECOND, 
            (SELECT created_at FROM operation_timelines t2 
             WHERE t2.operation_id = t1.operation_id 
             ORDER BY created_at ASC LIMIT 1),
            (SELECT created_at FROM operation_timelines t3 
             WHERE t3.operation_id = t1.operation_id 
             ORDER BY created_at DESC LIMIT 1)
          )) as avg_duration_seconds,
          COUNT(DISTINCT operation_id) as total_operations
        FROM operation_timelines t1
        WHERE machine_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY machine_id
      `;

    const [rows] = await sequelize.query(query, { replacements });

    return rows.length > 0
      ? rows[0]
      : { machine_id: machineId, avg_duration_seconds: null, total_operations: 0 };
  } catch (error) {
    logError("CYCLE_DURATION_ANALYSIS_ERROR", {
      machineId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get operations with anomalies.
 */
async function getAnomalousOperations(machineId, days = 7) {
  try {
    const dialect = typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";
    const safeDays = normalizeDays(days, 7);
    const replacements = [
      machineId,
      safeDays,
      TIMELINE_EVENTS.PLC_ERROR,
      TIMELINE_EVENTS.PLC_TIMEOUT,
      TIMELINE_EVENTS.ANOMALY_DETECTED,
    ];
    const query = dialect === "mssql"
      ? `
        SELECT 
          operation_id,
          machine_id,
          MAX(part_id) as part_id,
          COUNT(*) as event_count,
          STRING_AGG(event_type, ',') as events
        FROM (
          SELECT DISTINCT operation_id, machine_id, part_id, event_type, created_at
          FROM operation_timelines
          WHERE machine_id = ?
            AND created_at >= DATEADD(DAY, -?, SYSUTCDATETIME())
            AND event_type IN (?, ?, ?)
        ) distinct_events
        GROUP BY operation_id, machine_id
        ORDER BY MAX(created_at) DESC
      `
      : `
        SELECT 
          operation_id,
          machine_id,
          part_id,
          COUNT(*) as event_count,
          GROUP_CONCAT(DISTINCT event_type ORDER BY event_type) as events
        FROM operation_timelines
        WHERE machine_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND event_type IN (?, ?, ?)
        GROUP BY operation_id
        ORDER BY created_at DESC
      `;

    const [rows] = await sequelize.query(query, { replacements });

    return {
      machineId,
      period: `${days}d`,
      anomalousOperations: rows,
      count: rows.length,
    };
  } catch (error) {
    logError("ANOMALY_QUERY_ERROR", {
      machineId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Cleanup old timeline records.
 */
async function cleanupOldTimelines(daysToKeep = 90) {
  try {
    const dialect = typeof sequelize.getDialect === "function" ? sequelize.getDialect() : "mysql";
    const safeDays = normalizeDays(daysToKeep, 90);
    const query = dialect === "mssql"
      ? `
        DELETE FROM operation_timelines
        WHERE created_at < DATEADD(DAY, -?, SYSUTCDATETIME())
      `
      : `
        DELETE FROM operation_timelines
        WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      `;

    const [result] = await sequelize.query(query, {
      replacements: [safeDays],
    });

    const rowsDeleted =
      result?.affectedRows ??
      result?.rowCount ??
      (Array.isArray(result) ? result.length : 0);

    logInfo("TIMELINE_CLEANUP_COMPLETE", {
      daysToKeep: safeDays,
      rowsDeleted,
    });

    return { rowsDeleted };
  } catch (error) {
    logError("TIMELINE_CLEANUP_ERROR", {
      error: error.message,
    });
    throw error;
  }
}

module.exports = {
  TIMELINE_EVENTS,
  ensureTimelineTable,
  recordTimelineEvent,
  getOperationTimeline,
  getOperationTimelineWithDuration,
  queryTimelines,
  getAverageCycleDuration,
  getAnomalousOperations,
  cleanupOldTimelines,
};
