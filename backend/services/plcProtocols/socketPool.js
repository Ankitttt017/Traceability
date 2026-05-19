const net = require("net");
const plcSocketManager = require("../plcSocketManager");

const POOL_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.PLC_SOCKET_POOL_ENABLED || "true").trim().toLowerCase()
);
const DEFAULT_IDLE_MS = Math.max(Number(process.env.PLC_SOCKET_IDLE_MS || 10000), 1000);
const DEFAULT_LEASE_TIMEOUT_MS = Math.max(Number(process.env.PLC_SOCKET_LEASE_TIMEOUT_MS || 15000), 1000);

const pool = new Map();

function createSocketClient({ ip, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (handler) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      handler(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("error", done((error) => reject(error)));
    socket.once("timeout", done(() => reject(new Error("PLC connect timeout"))));
    socket.connect(
      Number(port),
      ip,
      done(() => {
        socket.setTimeout(0);
        resolve(socket);
      })
    );
  });
}

function attachSocketLifecycle(key, socket) {
  const cleanup = () => {
    const entry = pool.get(key);
    if (entry && entry.socket === socket) {
      pool.delete(key);
    }
  };
  socket.once("close", cleanup);
  socket.once("error", cleanup);
}

const waiters = new Map(); // key -> [resolve]

async function acquireSocket({ ip, port, timeoutMs }) {
  const key = `${ip}:${port}`;
  const startTime = Date.now();
  const deadline = startTime + (timeoutMs || DEFAULT_LEASE_TIMEOUT_MS);

  if (!POOL_ENABLED) {
    const socket = await createSocketClient({ ip, port, timeoutMs });
    return { socket, pooled: false, key: null };
  }

  while (true) {
    const existing = pool.get(key);
    
    if (existing) {
      if (existing.socket && !existing.socket.destroyed && !existing.inUse) {
        existing.inUse = true;
        existing.lastUsedAt = Date.now();
        return { socket: existing.socket, pooled: true, key };
      }
      
      // If destroyed, remove and continue to create new
      if (existing.socket?.destroyed) {
        pool.delete(key);
      } else {
        // Socket is in use, must wait
        if (Date.now() >= deadline) {
          throw new Error(`Timeout waiting for PLC connection lease (${key})`);
        }
        
        if (!waiters.has(key)) waiters.set(key, []);
        await new Promise(resolve => {
          const timeout = setTimeout(resolve, 100); // Check every 100ms or when notified
          waiters.get(key).push(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
        continue;
      }
    }

    // No existing socket or it was destroyed, create a new one
    try {
      const qDepth = waiters.get(key)?.length || 0;
      console.log(`[PLC:SocketPool] Creating new connection for ${key} (waiters: ${qDepth})`);
      const socket = await createSocketClient({ ip, port, timeoutMs: Math.max(300, deadline - Date.now()) });
      pool.set(key, {
        socket,
        inUse: true,
        lastUsedAt: Date.now(),
      });
      attachSocketLifecycle(key, socket);
      return { socket, pooled: true, key };
    } catch (error) {
      // Notify next waiter if connection failed
      const list = waiters.get(key);
      if (list && list.length > 0) list.shift()();
      throw error;
    }
  }
}

function releaseSocket({ socket, pooled, key }) {
  if (!pooled) {
    try {
      socket.removeAllListeners();
      socket.destroy();
    } catch (_error) {
      // noop
    }
    return;
  }

  const entry = pool.get(key);
  if (!entry || entry.socket !== socket) {
    // If it's not the current entry, just destroy it
    try { 
      socket.removeAllListeners();
      socket.destroy(); 
    } catch(e) {}
    return;
  }

  if (socket.destroyed) {
    pool.delete(key);
    // Notify next waiter
    const list = waiters.get(key);
    if (list && list.length > 0) {
      const next = list.shift();
      if (next) next();
    }
    return;
  }

  // Cleanup listeners before returning to pool to prevent MaxListenersExceededWarning
  try {
    socket.removeAllListeners("data");
    socket.removeAllListeners("error");
    socket.removeAllListeners("timeout");
  } catch (e) {
    console.warn(`[PLC:SocketPool] Error cleaning up listeners for ${key}:`, e.message);
  }

  entry.inUse = false;
  entry.lastUsedAt = Date.now();
  
  // Notify next waiter
  const list = waiters.get(key);
  if (list && list.length > 0) {
    const next = list.shift();
    if (next) next();
  }
}

async function withSocket({ ip, port, timeoutMs }, fn) {
  // Always use ephemeral sockets to prevent data interleaving.
  // Persistent sockets (plcSocketManager) must NOT be shared across
  // multi-step SLMP exchanges (handshake, probe) because concurrent
  // operations on the same socket corrupt the protocol framing.
  const lease = await acquireSocket({ ip, port, timeoutMs });
  try {
    const res = await fn(lease.socket);
    return res;
  } catch (error) {
    try {
      lease.socket.destroy();
    } catch (_) {}
    throw error;
  } finally {
    releaseSocket(lease);
  }
}

function cleanupIdleSockets() {
  if (!POOL_ENABLED) {
    return;
  }
  const now = Date.now();
  for (const [key, entry] of pool.entries()) {
    if (entry.inUse) {
      continue;
    }
    if (now - entry.lastUsedAt > DEFAULT_IDLE_MS) {
      try {
        entry.socket.destroy();
      } catch (_error) {
        // noop
      }
      pool.delete(key);
    }
  }
}

if (POOL_ENABLED) {
  const interval = setInterval(cleanupIdleSockets, Math.max(DEFAULT_IDLE_MS / 2, 1000));
  interval.unref?.();
}

module.exports = {
  withSocket,
  acquireSocket,
  releaseSocket,
};
