/**
 * IndusTrace Folder Watcher Service
 * ─────────────────────────────────────────────────────────────────
 * Monitors local and shared network folders for quality result files.
 */

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');
const { parsePayload } = require('./parserEngineService');

class FolderWatcherService {
  constructor() {
    this.watchers = new Map(); // machineId -> watcher instance
  }

  /**
   * Starts watching a folder for a specific machine.
   */
  async startWatching(machineId, config, onPayload) {
    const { folderPath, pattern = '*.*', parser = 'JSON', deleteAfterRead = true } = config;
    
    if (!folderPath) return;

    if (this.watchers.has(machineId)) {
      await this.stopWatching(machineId);
    }

    console.log(`[FolderWatcher] Starting for Machine ${machineId} at ${folderPath}`);

    const fullPattern = path.join(folderPath, pattern).replace(/\\/g, '/');
    const watcher = chokidar.watch(fullPattern, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
      }
    });

    watcher.on('add', async (filePath) => {
      console.log(`[FolderWatcher] New file detected: ${filePath}`);
      try {
        const content = await fs.readFile(filePath);
        const parsed = await parsePayload(content, parser);
        
        if (parsed) {
          onPayload(parsed, { source: 'FOLDER', filePath });
        }

        if (deleteAfterRead) {
          await fs.remove(filePath);
        }
      } catch (error) {
        console.error(`[FolderWatcher] Error processing file ${filePath}:`, error.message);
      }
    });

    this.watchers.set(machineId, watcher);
  }

  async stopWatching(machineId) {
    const watcher = this.watchers.get(machineId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(machineId);
      console.log(`[FolderWatcher] Stopped for Machine ${machineId}`);
    }
  }

  async stopAll() {
    for (const machineId of this.watchers.keys()) {
      await this.stopWatching(machineId);
    }
  }
}

module.exports = new FolderWatcherService();
