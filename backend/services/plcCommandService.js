const net = require("net");

function sendPlcCommand({ ip, port, command, timeoutMs = 3000 }) {
  return new Promise((resolve) => {
    if (!ip || !port) {
      resolve({ ok: false, message: "PLC endpoint missing" });
      return;
    }

    const client = new net.Socket();
    let settled = false;

    const done = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        client.destroy();
      } catch (_e) {
        // noop
      }
      resolve(payload);
    };

    client.setTimeout(timeoutMs);
    client.connect(Number(port), ip, () => {
      client.write(`${command}\n`);
      done({ ok: true, message: "Command sent" });
    });

    client.on("error", (error) => {
      done({ ok: false, message: error.message });
    });

    client.on("timeout", () => {
      done({ ok: false, message: "PLC command timeout" });
    });
  });
}

module.exports = { sendPlcCommand };
