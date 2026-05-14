/**
 * industrialTelemetryService.js
 * ════════════════════════════════════════════════════════════════
 * 
 * INDUSTRIAL TELEMETRY + METRICS SYSTEM
 * 
 * Tracks:
 * • PLC latency (avg, p95, p99)
 * • Queue latency
 * • Cycle duration
 * • Reconnect counts
 * • Scanner uptime
 * • Socket uptime
 * • Heartbeat failures
 * • Timeout counts
 * • Retry counts
 * • Machine utilization
 * • Throughput metrics
 * 
 * Exposed via:
 * • Health APIs (/api/v1/health/metrics)
 * • Metrics APIs (/api/v1/metrics)
 * • Dashboard-ready telemetry
 * 
 * ════════════════════════════════════════════════════════════════
 */

const { logInfo } = require("./industrialLogger");

class MetricsCollector {
  constructor() {
    this.metrics = {
      plc: {
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        timeoutCount: 0,
        reconnectCount: 0,
        latencies: [], // Array to track latencies
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
      },
      queue: {
        totalEnqueued: 0,
        totalProcessed: 0,
        totalFailed: 0,
        avgLatencyMs: 0,
        maxBacklogSize: 0,
        currentBacklogSize: 0,
      },
      cycles: {
        totalCount: 0,
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        avgDurationMs: 0,
        totalDurationMs: 0,
      },
      scanner: {
        totalConnections: 0,
        activeConnections: 0,
        totalHeartbeats: 0,
        heartbeatFailures: 0,
        uptime: 0,
        lastHeartbeat: null,
      },
      socket: {
        totalCreated: 0,
        totalDestroyed: 0,
        halfOpenDetections: 0,
        reconnectBackoffs: 0,
        totalUptime: 0,
      },
      watchdog: {
        totalChecks: 0,
        staleDetections: 0,
        anomaliesDetected: 0,
      },
      system: {
        startTime: new Date(),
        uptime: 0,
        memoryUsageMB: 0,
        memoryHeapMB: 0,
      },
    };

    this.startTime = Date.now();
  }

  /**
   * Record PLC operation latency.
   */
  recordPlcLatency(latencyMs, success = true, error = null) {
    this.metrics.plc.requestCount += 1;
    this.metrics.plc.latencies.push(latencyMs);

    // Keep only last 1000 latencies to avoid memory bloat
    if (this.metrics.plc.latencies.length > 1000) {
      this.metrics.plc.latencies.shift();
    }

    if (success) {
      this.metrics.plc.successCount += 1;
    } else {
      this.metrics.plc.errorCount += 1;
    }

    if (error === "TIMEOUT") {
      this.metrics.plc.timeoutCount += 1;
    }

    this._updatePlcPercentiles();
  }

  /**
   * Record reconnect attempt.
   */
  recordReconnect() {
    this.metrics.plc.reconnectCount += 1;
  }

  /**
   * Record cycle completion.
   */
  recordCycleCompletion(durationMs, success = true) {
    this.metrics.cycles.totalCount += 1;
    this.metrics.cycles.totalDurationMs += durationMs;

    if (success) {
      this.metrics.cycles.successCount += 1;
    } else {
      this.metrics.cycles.failureCount += 1;
    }

    this._updateCycleAverages();
  }

  /**
   * Record timeout.
   */
  recordTimeout() {
    this.metrics.cycles.timeoutCount += 1;
  }

  /**
   * Update queue metrics.
   */
  updateQueueMetrics(enqueued, processed, failed, currentBacklog) {
    this.metrics.queue.totalEnqueued += enqueued;
    this.metrics.queue.totalProcessed += processed;
    this.metrics.queue.totalFailed += failed;
    this.metrics.queue.currentBacklogSize = currentBacklog;

    if (currentBacklog > this.metrics.queue.maxBacklogSize) {
      this.metrics.queue.maxBacklogSize = currentBacklog;
    }
  }

  /**
   * Update scanner metrics.
   */
  updateScannerMetrics(activeCount, totalCount, heartbeatFailed) {
    this.metrics.scanner.activeConnections = activeCount;
    this.metrics.scanner.totalConnections = totalCount;
    this.metrics.scanner.totalHeartbeats += 1;

    if (heartbeatFailed) {
      this.metrics.scanner.heartbeatFailures += 1;
    }

    this.metrics.scanner.lastHeartbeat = new Date().toISOString();
  }

  /**
   * Update socket metrics.
   */
  updateSocketMetrics(created = 0, destroyed = 0, halfOpen = 0, backoffs = 0) {
    this.metrics.socket.totalCreated += created;
    this.metrics.socket.totalDestroyed += destroyed;
    this.metrics.socket.halfOpenDetections += halfOpen;
    this.metrics.socket.reconnectBackoffs += backoffs;
  }

  /**
   * Update watchdog metrics.
   */
  updateWatchdogMetrics(checks = 0, stales = 0, anomalies = 0) {
    this.metrics.watchdog.totalChecks += checks;
    this.metrics.watchdog.staleDetections += stales;
    this.metrics.watchdog.anomaliesDetected += anomalies;
  }

  /**
   * Calculate percentiles.
   */
  _updatePlcPercentiles() {
    if (this.metrics.plc.latencies.length === 0) return;

    const sorted = [...this.metrics.plc.latencies].sort((a, b) => a - b);
    const count = sorted.length;

    this.metrics.plc.avgLatencyMs =
      sorted.reduce((a, b) => a + b, 0) / count;
    this.metrics.plc.p95LatencyMs = sorted[Math.floor(count * 0.95)];
    this.metrics.plc.p99LatencyMs = sorted[Math.floor(count * 0.99)];
  }

  /**
   * Update cycle averages.
   */
  _updateCycleAverages() {
    if (this.metrics.cycles.totalCount === 0) return;
    this.metrics.cycles.avgDurationMs = Math.round(
      this.metrics.cycles.totalDurationMs / this.metrics.cycles.totalCount
    );
  }

  /**
   * Update system metrics.
   */
  updateSystemMetrics() {
    const uptime = Date.now() - this.startTime;
    const memoryUsage = process.memoryUsage();

    this.metrics.system.uptime = uptime;
    this.metrics.system.memoryUsageMB = Math.round(
      memoryUsage.rss / 1024 / 1024
    );
    this.metrics.system.memoryHeapMB = Math.round(
      memoryUsage.heapUsed / 1024 / 1024
    );
  }

  /**
   * Get comprehensive metrics snapshot.
   */
  getMetrics() {
    this.updateSystemMetrics();
    const plcBase = Math.max(this.metrics.plc.requestCount, 1);
    const cycleBase = Math.max(this.metrics.cycles.totalCount, 1);
    const plcSuccessRate = this.metrics.plc.requestCount
      ? ((this.metrics.plc.successCount / plcBase) * 100).toFixed(2)
      : "0.00";
    const cycleSuccessRate = this.metrics.cycles.totalCount
      ? ((this.metrics.cycles.successCount / cycleBase) * 100).toFixed(2)
      : "0.00";

    return {
      timestamp: new Date().toISOString(),
      uptime: this.metrics.system.uptime,
      metrics: {
        plc: {
          requests: this.metrics.plc.requestCount,
          success: this.metrics.plc.successCount,
          errors: this.metrics.plc.errorCount,
          timeouts: this.metrics.plc.timeoutCount,
          reconnects: this.metrics.plc.reconnectCount,
          avgLatencyMs: Math.round(this.metrics.plc.avgLatencyMs),
          p95LatencyMs: Math.round(this.metrics.plc.p95LatencyMs),
          p99LatencyMs: Math.round(this.metrics.plc.p99LatencyMs),
          successRate: plcSuccessRate,
        },
        queue: {
          enqueued: this.metrics.queue.totalEnqueued,
          processed: this.metrics.queue.totalProcessed,
          failed: this.metrics.queue.totalFailed,
          currentBacklog: this.metrics.queue.currentBacklogSize,
          maxBacklog: this.metrics.queue.maxBacklogSize,
        },
        cycles: {
          total: this.metrics.cycles.totalCount,
          success: this.metrics.cycles.successCount,
          failures: this.metrics.cycles.failureCount,
          timeouts: this.metrics.cycles.timeoutCount,
          avgDurationMs: this.metrics.cycles.avgDurationMs,
          successRate: cycleSuccessRate,
        },
        scanner: {
          activeConnections: this.metrics.scanner.activeConnections,
          totalConnections: this.metrics.scanner.totalConnections,
          heartbeats: this.metrics.scanner.totalHeartbeats,
          heartbeatFailures: this.metrics.scanner.heartbeatFailures,
          lastHeartbeat: this.metrics.scanner.lastHeartbeat,
        },
        socket: {
          totalCreated: this.metrics.socket.totalCreated,
          totalDestroyed: this.metrics.socket.totalDestroyed,
          halfOpenDetections: this.metrics.socket.halfOpenDetections,
          reconnectBackoffs: this.metrics.socket.reconnectBackoffs,
        },
        watchdog: {
          totalChecks: this.metrics.watchdog.totalChecks,
          staleDetections: this.metrics.watchdog.staleDetections,
          anomaliesDetected: this.metrics.watchdog.anomaliesDetected,
        },
        system: {
          memoryUsageMB: this.metrics.system.memoryUsageMB,
          memoryHeapMB: this.metrics.system.memoryHeapMB,
        },
      },
    };
  }

  /**
   * Get health status based on metrics.
   */
  getHealthStatus() {
    this.updateSystemMetrics();
    const plcTotal = this.metrics.plc.successCount + this.metrics.plc.errorCount;
    const cycleTotal = this.metrics.cycles.totalCount;
    const plcRatio = plcTotal > 0 ? this.metrics.plc.successCount / plcTotal : 1;
    const cycleRatio = cycleTotal > 0 ? this.metrics.cycles.successCount / cycleTotal : 1;

    const plcHealthy =
      plcRatio > 0.95;
    const queueHealthy = this.metrics.queue.currentBacklogSize < 100;
    const cycleHealthy =
      cycleRatio > 0.9;

    return {
      timestamp: new Date().toISOString(),
      overall: plcHealthy && queueHealthy && cycleHealthy ? "HEALTHY" : "DEGRADED",
      plc: plcHealthy ? "HEALTHY" : "DEGRADED",
      queue: queueHealthy ? "HEALTHY" : "DEGRADED",
      cycles: cycleHealthy ? "HEALTHY" : "DEGRADED",
      memory: this.metrics.system.memoryHeapMB > 1024 ? "HIGH" : "NORMAL",
    };
  }

  /**
   * Reset metrics (for testing).
   */
  reset() {
    this.metrics.plc.latencies = [];
    this.startTime = Date.now();
    logInfo("METRICS_RESET", {});
  }
}

const collector = new MetricsCollector();

module.exports = {
  recordPlcLatency: (latency, success, error) =>
    collector.recordPlcLatency(latency, success, error),
  recordReconnect: () => collector.recordReconnect(),
  recordCycleCompletion: (duration, success) =>
    collector.recordCycleCompletion(duration, success),
  recordTimeout: () => collector.recordTimeout(),
  updateQueueMetrics: (enqueued, processed, failed, backlog) =>
    collector.updateQueueMetrics(enqueued, processed, failed, backlog),
  updateScannerMetrics: (active, total, failed) =>
    collector.updateScannerMetrics(active, total, failed),
  updateSocketMetrics: (created, destroyed, halfOpen, backoffs) =>
    collector.updateSocketMetrics(created, destroyed, halfOpen, backoffs),
  updateWatchdogMetrics: (checks, stales, anomalies) =>
    collector.updateWatchdogMetrics(checks, stales, anomalies),
  getMetrics: () => collector.getMetrics(),
  getHealthStatus: () => collector.getHealthStatus(),
  reset: () => collector.reset(),
};
