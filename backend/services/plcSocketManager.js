/**
 * plcSocketManager.js
 * ════════════════════════════════════════════════════════════════
 * 
 * INDUSTRIAL PERSISTENT PLC SOCKET LIFECYCLE MANAGER
 * 
 * Requirements:
 * • Socket pool per PLC endpoint
 * • TCP keepalive + reconnect backoff
 * • Half-open socket detection
 * • Stale socket replacement + idle cleanup
 * • Reconnect throttling
 * • Socket health telemetry
 * • Automatic recovery
 * 
 * Prevents:
 * • Reconnect on every PLC request
 * • Duplicate PLC sockets
 * • Unmanaged parallel connections
 * 
 * ════════════════════════════════════════════════════════════════
 */

const net = require("net");
const { logInfo, logWarn, logError } = require("./industrialLogger");

const SOCKET_KEEPALIVE_INTERVAL_MS = Number(process.env.SOCKET_KEEPALIVE_INTERVAL_MS || 5000);
const SOCKET_IDLE_TIMEOUT_MS = Number(process.env.SOCKET_IDLE_TIMEOUT_MS || 60000);
const SOCKET_RECONNECT_MAX_BACKOFF_MS = Number(process.env.SOCKET_RECONNECT_MAX_BACKOFF_MS || 30000);
const SOCKET_HEALTH_CHECK_INTERVAL_MS = Number(process.env.SOCKET_HEALTH_CHECK_INTERVAL_MS || 10000);

class SocketPool {
  constructor(ip, port) {
    this.endpoint = `${ip}:${port}`;
    this.ip = ip;
    this.port = port;

    this.activeSocket = null; // Currently in-use socket
    this.candidateSocket = null; // Next socket being established
    this.reserveSocket = null; // Standby for rapid failover

    this.stats = {
      connects: 0,
      disconnects: 0,
      errors: 0,
      halfOpens: 0,
      replacements: 0,
      idleCleanups: 0,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      uptime: 0,
    };

    this.reconnectAttempts = 0;
    this.reconnectBackoffMs = 100;
    this.lastReconnectAttempt = 0;
    this.inFlight = new Set(); // Track in-flight operations

    this.socketHealthRef = null;
    this.idleCleanupRef = null;
    this.keepaliveRef = null;
  }

  /**
   * Get or create an active socket for this endpoint.
   * Returns a promise that resolves to a connected socket.
   */
  async getSocket() {
    // Check if active socket is healthy
    if (this.activeSocket && this._isSocketHealthy(this.activeSocket)) {
      this.stats.lastActivity = new Date().toISOString();
      return this.activeSocket;
    }

    // Try candidate socket (if connecting)
    if (this.candidateSocket && this._isSocketHealthy(this.candidateSocket)) {
      this.activeSocket = this.candidateSocket;
      this.candidateSocket = null;
      this.stats.lastActivity = new Date().toISOString();
      return this.activeSocket;
    }

    // Try reserve socket (failover)
    if (this.reserveSocket && this._isSocketHealthy(this.reserveSocket)) {
      this.activeSocket = this.reserveSocket;
      this.reserveSocket = null;
      this.stats.lastActivity = new Date().toISOString();
      return this.activeSocket;
    }

    // Need to create new connection
    return this._ensureSocketConnected();
  }

  /**
   * Marks socket as actively used (updates idle timeout).
   */
  markInFlight(operationId) {
    this.inFlight.add(operationId);
    this.stats.lastActivity = new Date().toISOString();
    this._resetIdleCleanup();
  }

  markInFlightComplete(operationId) {
    this.inFlight.delete(operationId);
  }

  /**
   * Internal: Check if socket is still viable.
   */
  _isSocketHealthy(socket) {
    if (!socket) return false;
    if (socket.destroyed) return false;
    if (socket.readyState !== "open" && socket.connecting !== true) return false;
    return true;
  }

  /**
   * Internal: Ensure connected socket.
   */
  async _ensureSocketConnected() {
    // Throttle reconnect attempts
    const timeSinceLastAttempt = Date.now() - this.lastReconnectAttempt;
    if (timeSinceLastAttempt < this.reconnectBackoffMs) {
      await new Promise((r) =>
        setTimeout(r, this.reconnectBackoffMs - timeSinceLastAttempt)
      );
    }

    this.lastReconnectAttempt = Date.now();

    return new Promise((resolve, reject) => {
      if (this.candidateSocket) {
        // Already connecting
        this.candidateSocket.once("connect", () => {
          this.activeSocket = this.candidateSocket;
          this.candidateSocket = null;
          this.stats.connects += 1;
          this.reconnectAttempts = 0;
          this.reconnectBackoffMs = 100;
          logInfo("SOCKET_CONNECTED", {
            endpoint: this.endpoint,
            attempt: this.stats.connects,
          });
          resolve(this.activeSocket);
        });
        this.candidateSocket.once("error", (err) => {
          this.stats.errors += 1;
          this._handleConnectionError(err);
          reject(err);
        });
        return;
      }

      const socket = new net.Socket();
      this.candidateSocket = socket;

      socket.setKeepAlive(true, SOCKET_KEEPALIVE_INTERVAL_MS);
      socket.setTimeout(5000);

      // Persistent error handler to prevent process crash (Requirement 4)
      socket.on("error", (err) => {
        this.stats.errors += 1;
        logWarn("SOCKET_ERROR", { endpoint: this.endpoint, error: err.message });
        if (socket === this.activeSocket) {
          this.activeSocket = null;
          this.stats.disconnects += 1;
        }
      });

      socket.on("close", (hadError) => {
        logInfo("SOCKET_CLOSED", { endpoint: this.endpoint, hadError });
        if (socket === this.activeSocket) {
          this.activeSocket = null;
          this.stats.disconnects += 1;
        }
      });

      socket.on("timeout", () => {
        logWarn("SOCKET_TIMEOUT", { endpoint: this.endpoint });
        socket.destroy(new Error("Socket timeout"));
      });

      socket.once("connect", () => {
        this.activeSocket = this.candidateSocket;
        this.candidateSocket = null;
        this.stats.connects += 1;
        this.reconnectAttempts = 0;
        this.reconnectBackoffMs = 100;

        this._setupSocketHealthMonitor();
        this._setupIdleCleanup();

        logInfo("SOCKET_CONNECTED", {
          endpoint: this.endpoint,
          attempt: this.stats.connects,
        });
        resolve(this.activeSocket);
      });

      socket.connect(this.port, this.ip);
    });
  }

  /**
   * Handle connection errors and implement exponential backoff.
   */
  _handleConnectionError(error) {
    this.candidateSocket = null;
    this.reconnectAttempts += 1;

    // Exponential backoff: 100ms, 200ms, 400ms, ..., up to MAX
    this.reconnectBackoffMs = Math.min(
      this.reconnectBackoffMs * 2,
      SOCKET_RECONNECT_MAX_BACKOFF_MS
    );

    logWarn("SOCKET_RECONNECT_BACKOFF", {
      endpoint: this.endpoint,
      attempt: this.reconnectAttempts,
      nextBackoffMs: this.reconnectBackoffMs,
      error: error.message,
    });
  }

  /**
   * Detect half-open sockets (no activity for long time).
   */
  _setupSocketHealthMonitor() {
    if (this.socketHealthRef) clearInterval(this.socketHealthRef);

    this.socketHealthRef = setInterval(() => {
      if (!this.activeSocket || this.activeSocket.destroyed) {
        clearInterval(this.socketHealthRef);
        return;
      }

      // Check for idle inactivity
      const timeSinceActivity = Date.now() - new Date(this.stats.lastActivity).getTime();
      if (timeSinceActivity > SOCKET_IDLE_TIMEOUT_MS && this.inFlight.size === 0) {
        // Socket appears idle, plan replacement
        this._planSocketReplacement();
      }
    }, SOCKET_HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Reset idle cleanup timer (called on activity).
   */
  _resetIdleCleanup() {
    if (this.idleCleanupRef) clearTimeout(this.idleCleanupRef);

    this.idleCleanupRef = setTimeout(() => {
      if (this.inFlight.size === 0 && this.activeSocket) {
        this.stats.idleCleanups += 1;
        logInfo("SOCKET_IDLE_CLEANUP", { endpoint: this.endpoint });
        this._closeSocket(this.activeSocket);
        this.activeSocket = null;
      }
    }, SOCKET_IDLE_TIMEOUT_MS);
  }

  /**
   * Plan socket replacement without disrupting active operations.
   */
  _planSocketReplacement() {
    if (this.reserveSocket) return; // Already have reserve

    this.stats.replacements += 1;
    logInfo("SOCKET_REPLACEMENT_PLANNED", { endpoint: this.endpoint });

    this.reserveSocket = new net.Socket();
    this.reserveSocket.setKeepAlive(true, SOCKET_KEEPALIVE_INTERVAL_MS);
    this.reserveSocket.once("connect", () => {
      logInfo("SOCKET_RESERVE_READY", { endpoint: this.endpoint });
      // Reserve is now ready, will be promoted on next getSocket() call
    });
    this.reserveSocket.once("error", () => {
      // Reserve connection failed, ignore
      this._closeSocket(this.reserveSocket);
      this.reserveSocket = null;
    });

    this.reserveSocket.connect(this.port, this.ip);
  }

  /**
   * Safely close a socket.
   */
  _closeSocket(socket) {
    if (!socket) return;
    try {
      socket.destroy();
    } catch (_err) {
      // noop
    }
  }

  /**
   * Shutdown this pool.
   */
  shutdown() {
    if (this.socketHealthRef) clearInterval(this.socketHealthRef);
    if (this.idleCleanupRef) clearTimeout(this.idleCleanupRef);
    if (this.keepaliveRef) clearInterval(this.keepaliveRef);

    this._closeSocket(this.activeSocket);
    this._closeSocket(this.candidateSocket);
    this._closeSocket(this.reserveSocket);

    this.activeSocket = null;
    this.candidateSocket = null;
    this.reserveSocket = null;
    this.inFlight.clear();

    logInfo("SOCKET_POOL_SHUTDOWN", {
      endpoint: this.endpoint,
      stats: this.stats,
    });
  }

  /**
   * Get telemetry for this socket pool.
   */
  getMetrics() {
    const uptime = Date.now() - new Date(this.stats.createdAt).getTime();
    return {
      endpoint: this.endpoint,
      connected: this._isSocketHealthy(this.activeSocket),
      inFlight: this.inFlight.size,
      reconnectAttempts: this.reconnectAttempts,
      stats: {
        ...this.stats,
        uptime,
      },
    };
  }
}

class PlcSocketManager {
  constructor() {
    this.pools = new Map(); // endpoint → SocketPool
  }

  /**
   * Get socket for endpoint (lazy-creates pool).
   */
  async getSocket(ip, port) {
    const endpoint = `${ip}:${port}`;
    if (!this.pools.has(endpoint)) {
      this.pools.set(endpoint, new SocketPool(ip, port));
    }
    const pool = this.pools.get(endpoint);
    const socket = await pool.getSocket();
    return socket;
  }

  /**
   * Mark operation in-flight for the endpoint.
   */
  markInFlight(ip, port, operationId) {
    const endpoint = `${ip}:${port}`;
    const pool = this.pools.get(endpoint);
    if (pool) pool.markInFlight(operationId);
  }

  /**
   * Mark operation complete.
   */
  markInFlightComplete(ip, port, operationId) {
    const endpoint = `${ip}:${port}`;
    const pool = this.pools.get(endpoint);
    if (pool) pool.markInFlightComplete(operationId);
  }

  /**
   * Get all metrics.
   */
  getAllMetrics() {
    const metrics = [];
    for (const [endpoint, pool] of this.pools.entries()) {
      metrics.push(pool.getMetrics());
    }
    return metrics;
  }

  /**
   * Get metrics for single endpoint.
   */
  getEndpointMetrics(ip, port) {
    const endpoint = `${ip}:${port}`;
    const pool = this.pools.get(endpoint);
    return pool ? pool.getMetrics() : null;
  }

  /**
   * Shutdown all pools.
   */
  shutdown() {
    for (const [endpoint, pool] of this.pools.entries()) {
      pool.shutdown();
    }
    this.pools.clear();
    logInfo("SOCKET_MANAGER_SHUTDOWN", { totalPools: 0 });
  }
}

module.exports = new PlcSocketManager();
