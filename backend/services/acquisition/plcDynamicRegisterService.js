/**
 * IndusTrace Dynamic PLC Register Service
 * ─────────────────────────────────────────────────────────────────
 * Manages dynamically added PLC registers for additional parameters.
 * Optimizes reading by grouping registers into batches.
 */

const { readModbusRegisters, readSlmpRegisters } = require('../plcIoService');

function parseRegister(rawValue, fallbackDevice = "D") {
  const text = String(rawValue ?? "").trim().toUpperCase();
  if (!text) {
    return { register: null, device: fallbackDevice };
  }
  const direct = Number(text);
  if (Number.isFinite(direct)) {
    return { register: Math.trunc(direct), device: fallbackDevice };
  }
  const match = text.match(/^([A-Z]+)?\s*(\d+)$/);
  if (!match) {
    return { register: null, device: fallbackDevice };
  }
  const register = Number(match[2]);
  if (!Number.isFinite(register)) {
    return { register: null, device: fallbackDevice };
  }
  return {
    register: Math.trunc(register),
    device: String(match[1] || fallbackDevice || "").trim().toUpperCase() || fallbackDevice,
  };
}

class PlcDynamicRegisterService {
  /**
   * Reads a set of dynamic registers for a machine and normalizes them.
   * @param {Object} machine - Machine instance
   * @param {Array} registerMap - Array of { name, register, type, scale, unit }
   * @returns {Promise<Object>} - Normalized parameters { T1: 120.5, ... }
   */
  async readParameters(machine, registerMap) {
    if (!registerMap || !Array.isArray(registerMap) || registerMap.length === 0) {
      return {};
    }

    const protocol = String(machine.plc_protocol || 'TCP_TEXT').toUpperCase();
    const parameters = {};

    try {
      if (protocol === 'MODBUS_TCP') {
        const results = await this.readModbusBatch(machine, registerMap);
        Object.assign(parameters, results);
      } else if (protocol === 'SLMP') {
        const results = await this.readSlmpBatch(machine, registerMap);
        Object.assign(parameters, results);
      }
    } catch (error) {
      console.error(`[PlcDynamicReg] Batch read failed for ${machine.machine_name}:`, error.message);
    }

    return parameters;
  }

  async readModbusBatch(machine, registerMap) {
    const results = {};
    for (const reg of registerMap) {
      try {
        const token = parseRegister(reg.register);
        if (token.register === null) {
          results[reg.name] = null;
          continue;
        }
        const val = await readModbusRegisters({
          ip: machine.plc_ip || machine.machine_ip,
          port: machine.plc_port || machine.machine_port,
          unitId: machine.plc_unit_id || 1,
          registers: [token.register]
        });
        const rawVal = val?.values?.[token.register];
        results[reg.name] = this.scaleValue(rawVal, reg.scale);
      } catch (e) {
        results[reg.name] = null;
      }
    }
    return results;
  }

  async readSlmpBatch(machine, registerMap) {
    const results = {};
    for (const reg of registerMap) {
      try {
        const token = parseRegister(reg.register, machine.plc_slmp_device || 'D');
        if (token.register === null) {
          results[reg.name] = null;
          continue;
        }
        const val = await readSlmpRegisters({
          ip: machine.plc_ip || machine.machine_ip,
          port: machine.plc_port || machine.machine_port,
          registers: [{ register: token.register, device: token.device }]
        });
        const rawVal = val?.values?.[token.register];
        results[reg.name] = this.scaleValue(rawVal, reg.scale);
      } catch (e) {
        results[reg.name] = null;
      }
    }
    return results;
  }

  scaleValue(val, scale) {
    if (val === null || val === undefined) return null;
    const factor = parseFloat(scale) || 1;
    return val * factor;
  }
}

module.exports = new PlcDynamicRegisterService();
