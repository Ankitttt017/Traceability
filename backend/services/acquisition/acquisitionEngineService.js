/**
 * IndusTrace Acquisition Engine Service
 * ─────────────────────────────────────────────────────────────────
 * Central orchestrator for multi-protocol data acquisition.
 * Manages HTTP, FTP, Folder, and PLC sources.
 */

const folderWatcher = require('./folderWatcherService');
const { normalizePayload } = require('./payloadNormalizationService');
const { parsePayload } = require('./parserEngineService');
const axios = require('axios'); // For HTTP sources

class AcquisitionEngineService {
  constructor() {
    this.activeMachines = new Set();
    this.diagnostics = new Map(); // machineId -> diagnostics data
    this.onResultCallback = null;
  }

  /**
   * Initializes the engine with a callback for processed results.
   */
  init(callback) {
    this.onResultCallback = callback;
  }

  /**
   * Starts all configured sources for a machine.
   */
  async startMachineAcquisition(machine) {
    const machineId = machine.id;
    const spcConfig = machine.spcConfig || {};
    
    if (!spcConfig.enabled) return;
    
    console.log(`[AcquisitionEngine] Initializing for Machine ${machineId} (${machine.machineName})`);
    this.activeMachines.add(machineId);
    this.initDiagnostics(machineId);

    const protocols = spcConfig.activeProtocols || [spcConfig.mode || 'IP_PUSH'];

    for (const protocol of protocols) {
      try {
        await this.initSource(machineId, protocol, spcConfig);
      } catch (error) {
        this.logError(machineId, protocol, `Init failed: ${error.message}`);
      }
    }
  }

  async initSource(machineId, protocol, config) {
    switch (protocol) {
      case 'FOLDER':
        await folderWatcher.startWatching(machineId, config.folderConfig || {}, (payload, meta) => {
          this.handleIncomingData(machineId, protocol, payload, meta);
        });
        break;
      
      case 'HTTP_API':
        // HTTP is usually polling or push. If push, it's handled by a controller. 
        // If polling, we start an interval here.
        if (config.httpConfig?.pollingEnabled) {
          this.startHttpPolling(machineId, config.httpConfig);
        }
        break;

      // Other protocols like FTP, PLC are managed by their respective services 
      // but reported here.
    }
  }

  /**
   * Central handler for all incoming data across all protocols.
   */
  async handleIncomingData(machineId, protocol, rawData, meta = {}) {
    this.updateDiagnostics(machineId, protocol, 'RECEIVED');

    try {
      // 1. Normalize (Requirement 10)
      const normalized = normalizePayload(rawData, { 
        ...meta, 
        machineId, 
        mode: protocol 
      });

      // 2. Report to system
      if (this.onResultCallback) {
        await this.onResultCallback(normalized);
      }

      this.updateDiagnostics(machineId, protocol, 'SUCCESS');
    } catch (error) {
      this.logError(machineId, protocol, `Processing failed: ${error.message}`);
      // Send to DLQ (Requirement 14 - implementation follows)
    }
  }

  // --- Diagnostics & Monitoring (Requirement 11) ---

  initDiagnostics(machineId) {
    this.diagnostics.set(machineId, {
      lastPacketTime: null,
      packetCount: 0,
      errorCount: 0,
      status: 'IDLE',
      protocols: {}
    });
  }

  updateDiagnostics(machineId, protocol, type) {
    const diag = this.diagnostics.get(machineId);
    if (!diag) return;

    diag.lastPacketTime = new Date().toISOString();
    diag.packetCount++;
    diag.status = 'ACTIVE';

    if (!diag.protocols[protocol]) {
      diag.protocols[protocol] = { count: 0, lastTime: null };
    }
    diag.protocols[protocol].count++;
    diag.protocols[protocol].lastTime = new Date().toISOString();
  }

  logError(machineId, protocol, message) {
    console.error(`[AcquisitionEngine][${protocol}] Machine ${machineId}: ${message}`);
    const diag = this.diagnostics.get(machineId);
    if (diag) diag.errorCount++;
  }

  getDiagnostics(machineId) {
    return this.diagnostics.get(machineId);
  }
}

module.exports = new AcquisitionEngineService();
