/**
 * IndusTrace Dynamic PLC Register Service
 * ─────────────────────────────────────────────────────────────────
 * Manages dynamically added PLC registers for additional parameters.
 * Optimizes reading by grouping registers into batches.
 */

const { readModbusRegisters, readSlmpRegisters } = require('../plcIoService');

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

    // 1. Batch Registers by Device/Type to optimize PLC communication
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
    // Modbus optimization: if registers are close, read them in one go
    // For now, read each or simple grouping
    for (const reg of registerMap) {
      try {
        const val = await readModbusRegisters({
          ip: machine.plc_ip,
          port: machine.plc_port,
          unitId: machine.plc_unit_id || 1,
          registers: [{ register: parseInt(reg.register), count: 1 }]
        });
        results[reg.name] = this.scaleValue(val[0], reg.scale);
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
        const val = await readSlmpRegisters({
          ip: machine.plc_ip,
          port: machine.plc_port,
          registers: [{ register: parseInt(reg.register), device: reg.device || machine.plc_slmp_device || 'D' }]
        });
        results[reg.name] = this.scaleValue(val[0], reg.scale);
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
