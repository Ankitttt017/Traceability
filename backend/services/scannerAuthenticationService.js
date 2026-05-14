/**
 * scannerAuthenticationService.js — Item #8
 * 
 * SCANNER SOURCE AUTHENTICATION
 * 
 * Validates:
 * • Scanner identity (IP) vs Machine binding.
 * • Authorized scanner IPs list.
 * • Duplicate scanner conflicts (same IP trying to scan for two different machines).
 * 
 * Prevents:
 * • Rogue scans from unauthorized IPs.
 * • Duplicate scanner sources triggering multiple cycles.
 */

const { logInfo, logWarn } = require("./industrialLogger");
const Machine = require("../models/Machine");
const { normalizeIp } = require("../utils/networkAddress");

class ScannerAuthenticationService {
  constructor() {
    this.scannerBinding = new Map(); // scannerIp -> machineId
    this.authorizedIps = new Set();  // Set of allowed IPs
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Load bindings from database
    const machines = await Machine.findAll({
      attributes: ["id", "scanner_ip", "status"]
    });

    for (const machine of machines) {
      if (machine.scanner_ip) {
        const ip = normalizeIp(machine.scanner_ip);
        if (ip) {
          this.scannerBinding.set(ip, machine.id);
          this.authorizedIps.add(ip);
        }
      }
    }

    this.initialized = true;
    logInfo("SCANNER_AUTH_INITIALIZED", { 
      authorizedCount: this.authorizedIps.size,
      bindingCount: this.scannerBinding.size 
    });
  }

  /**
   * Validate if a scan from a given IP is authorized for a specific machine.
   */
  async authenticate(scannerIp, targetMachineId) {
    if (!this.initialized) await this.initialize();

    const normalized = normalizeIp(scannerIp);
    if (!normalized) return { authorized: false, reason: "INVALID_IP" };

    // 1. Check if IP is in authorized list
    if (!this.authorizedIps.has(normalized)) {
      logWarn("UNAUTHORIZED_SCANNER_IP", { scannerIp: normalized, machineId: targetMachineId });
      return { authorized: false, reason: "UNAUTHORIZED_IP" };
    }

    // 2. Check machine binding
    const boundMachineId = this.scannerBinding.get(normalized);
    if (boundMachineId && Number(boundMachineId) !== Number(targetMachineId)) {
      logWarn("SCANNER_MACHINE_MISMATCH", { 
        scannerIp: normalized, 
        requestedMachineId: targetMachineId,
        boundMachineId 
      });
      return { authorized: false, reason: "MACHINE_MISMATCH" };
    }

    return { authorized: true };
  }

  /**
   * Update binding (called when machine config changes)
   */
  updateBinding(machineId, scannerIp) {
    const ip = normalizeIp(scannerIp);
    if (!ip) return;

    // Clear old binding if any
    for (const [sIp, mId] of this.scannerBinding.entries()) {
      if (mId === machineId) {
        this.scannerBinding.delete(sIp);
        this.authorizedIps.delete(sIp);
      }
    }

    this.scannerBinding.set(ip, machineId);
    this.authorizedIps.add(ip);
    logInfo("SCANNER_BINDING_UPDATED", { machineId, scannerIp: ip });
  }

  getBinding(scannerIp) {
    return this.scannerBinding.get(normalizeIp(scannerIp));
  }
}

module.exports = new ScannerAuthenticationService();
