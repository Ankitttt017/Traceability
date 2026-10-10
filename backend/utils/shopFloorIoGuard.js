/**
 * Shop-floor I/O switch — lets a developer run the backend locally against the shared database WITHOUT touching
 * the line's PLCs and scanners (the live server owns them; two backends reading/writing the same PLC registers at
 * the same time disturb each other).
 *
 *   backend/.env (local PC only):   SHOP_FLOOR_IO=off
 *
 * When off:
 *  - every outbound TCP connection to the shop-floor network is refused at the socket level (one choke point,
 *    so PLC polling, handshakes, interlocks, I/O Monitor reads/writes, scanner test reads, scanner client
 *    connections — any code path — cannot reach a PLC or scanner);
 *  - server.js skips the PLC pollers, the scanner TCP server and the jobs that would change live state in the
 *    shared database (report sync, machine-lock / scanner-state reset, startup recovery, alarm monitor).
 * The database, the web UI, reports and all read APIs keep working normally.
 *
 * Shop-floor network = address prefixes in SHOP_FLOOR_NETWORKS (comma separated, default "192.168.119."),
 * where all PLCs and scanners of the line are. The database host is never blocked.
 * The live server must NOT set SHOP_FLOOR_IO=off (default is on).
 */
const net = require("net");

const enabled = String(process.env.SHOP_FLOOR_IO || "on").trim().toLowerCase() !== "off";
const prefixes = String(process.env.SHOP_FLOOR_NETWORKS || "192.168.119.")
  .split(",").map((p) => p.trim()).filter(Boolean);
const dbHost = String(process.env.DB_HOST || "").trim();

const isShopFloorHost = (host) => {
  const h = String(host || "").trim();
  return Boolean(h) && h !== dbHost && prefixes.some((p) => h.startsWith(p));
};

let blockedCount = 0;

function install() {
  if (enabled || net.Socket.prototype.__shopFloorGuarded) return;
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    // connect(options[, cb]) | connect(port[, host][, cb]) | connect(path[, cb]); net.connect() / createConnection()
    // pass their already-normalised arguments as one array ([options, cb])
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (Array.isArray(args[0])) args = args[0].length > 1 ? [args[0][0], args[0][1]] : [args[0][0]];
    const host = first && typeof first === "object" ? (first.host || first.address) : (typeof args[1] === "string" ? args[1] : "");
    if (isShopFloorHost(host)) {
      blockedCount += 1;
      const port = first && typeof first === "object" ? first.port : first;
      const err = Object.assign(
        new Error(`Shop-floor I/O is disabled on this server (SHOP_FLOOR_IO=off): connection to ${host}:${port} blocked`),
        { code: "ESHOPFLOORIO_DISABLED", address: host, port },
      );
      if (blockedCount === 1 || blockedCount % 500 === 0) console.warn(`[ShopFloorIO] ${err.message} (blocked so far: ${blockedCount})`);
      process.nextTick(() => { this.destroy(err); });
      return this;
    }
    return originalConnect.apply(this, arguments);
  };
  net.Socket.prototype.__shopFloorGuarded = true;
  console.warn(`[ShopFloorIO] OFF — this backend will not connect to PLCs / scanners on ${prefixes.join(", ")} (local / development mode).`);
}

module.exports = {
  shopFloorIoEnabled: enabled,
  installShopFloorIoGuard: install,
  isShopFloorHost,
};
