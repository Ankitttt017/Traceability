/* ═══════════════════════════════════════════════════════════════════════════
   Background Excel export jobs.

   A large export (30 days ≈ 24 k parts, 450 MB of raw logs) takes minutes. Running it inside one HTTP request
   hit proxy / browser timeouts and nothing reached the client until the very end. Instead:
     create  → the job is queued and its id returned at once (HTTP 202)
     status  → the client polls progress / phase text
     file    → once done, the finished .xlsx (a temp file) is streamed as a normal download
   Only ONE export runs at a time (the rest wait in the queue) so exports cannot starve the API or the scanning
   stations of CPU / DB connections. Jobs live in this process's memory (the backend runs as a single pm2
   process); files are written to <os tmp>/traceability-exports and removed after download or after 1 hour.
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const EXPORT_DIR = path.join(os.tmpdir(), "traceability-exports");
const MAX_AGE_MS = 60 * 60 * 1000; // files and finished jobs older than this are removed
const DELETE_AFTER_DOWNLOAD_MS = 2 * 60 * 1000; // short grace period so a repeated click still works
const MAX_QUEUED = 20;

const jobs = new Map();
const queue = [];
let running = null;

/* Time estimate: seconds per part learnt from finished exports (moving average), so "23,665 parts · about 25 s"
   follows this server's real speed. Starting value from measurements (30 days ≈ 23 k parts ≈ 25 s warm). */
const ESTIMATE = { overheadSec: 2, secPerPart: 0.0011 };
function estimateSeconds(parts) {
  const n = Number(parts) || 0;
  return Math.max(2, Math.round(ESTIMATE.overheadSec + n * ESTIMATE.secPerPart));
}
function learnSpeed(parts, seconds) {
  if (!(parts >= 500) || !(seconds > 0)) return; // small exports are mostly fixed overhead
  const rate = Math.max(0, seconds - ESTIMATE.overheadSec) / parts;
  ESTIMATE.secPerPart = ESTIMATE.secPerPart * 0.6 + rate * 0.4;
}

// seconds still to go: from the measured progress once there is some, otherwise from the model
function remainingSeconds(job) {
  if (job.status === "queued") {
    const ahead = running ? remainingSeconds(running) || 0 : 0;
    return ahead + queue.slice(0, Math.max(0, queue.indexOf(job))).reduce((sum, j) => sum + estimateSeconds(j.rows), 0)
      + (job.rows ? estimateSeconds(job.rows) : 0) || null;
  }
  if (job.status !== "running") return null;
  const elapsed = (Date.now() - job.startedAt) / 1000;
  const model = job.rows ? estimateSeconds(job.rows) : null;
  const p = job.progress;
  if (p >= 10 && elapsed > 2) {
    const measured = (elapsed * (100 - p)) / p;
    return Math.max(1, Math.round(model ? (measured * p + Math.max(0, model - elapsed) * (100 - p)) / 100 : measured));
  }
  // slower than the model (busy database) and no measured progress yet: no number rather than a wrong one
  return model && model - elapsed >= 1 ? Math.round(model - elapsed) : null;
}

const ensureDir = () => { fs.mkdirSync(EXPORT_DIR, { recursive: true }); };
const unlinkQuiet = (file) => { if (file) fs.promises.unlink(file).catch(() => {}); };

function publicView(job) {
  const queuePosition = job.status === "queued" ? queue.indexOf(job) + 1 : 0;
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.status === "queued"
      ? (running ? `Waiting for ${queuePosition === 1 ? "1 export" : `${queuePosition} exports`} ahead to finish` : "Queued")
      : job.phase,
    rows: job.rows,
    parts: job.rows,
    etaSeconds: remainingSeconds(job),
    estimatedTotalSeconds: job.rows ? estimateSeconds(job.rows) : null,
    elapsedSeconds: job.startedAt ? Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000) : 0,
    error: job.error,
    fileName: job.status === "done" ? job.fileName : null,
    fileSize: job.status === "done" ? job.fileSize : null,
    queuePosition,
    createdAt: new Date(job.createdAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
  };
}

async function pump() {
  if (running || !queue.length) return;
  const job = queue.shift();
  running = job;
  job.status = "running";
  job.phase = "Starting";
  job.startedAt = Date.now();
  const update = ({ progress, phase, rows } = {}) => {
    if (Number.isFinite(progress)) job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
    if (phase && !job.cancelRequested) job.phase = phase;
    if (Number.isFinite(rows)) job.rows = rows;
  };
  try {
    ensureDir();
    const result = await job.run(job.filePath, update, { isCancelled: () => Boolean(job.cancelRequested) });
    if (job.cancelRequested) throw Object.assign(new Error("Export cancelled"), { cancelled: true });
    job.fileSize = fs.statSync(job.filePath).size;
    if (result && Number.isFinite(result.rows)) job.rows = result.rows;
    job.status = "done";
    job.progress = 100;
    job.phase = "Ready to download";
    learnSpeed(result?.parts ?? job.rows, (Date.now() - job.startedAt) / 1000);
    console.log(`[ExportJobs] ${job.label} ${job.id} done in ${((Date.now() - job.startedAt) / 1000).toFixed(1)} s — ${job.rows} rows, ${(job.fileSize / 1048576).toFixed(1)} MB`);
  } catch (err) {
    unlinkQuiet(job.filePath);
    // Windows: a just-closed file can still be locked for a moment — try once more
    const retry = setTimeout(() => unlinkQuiet(job.filePath), 3000);
    retry.unref?.();
    if (err?.cancelled || job.cancelRequested) {
      job.status = "cancelled";
      job.phase = "Cancelled";
      console.log(`[ExportJobs] ${job.label} ${job.id} cancelled after ${((Date.now() - job.startedAt) / 1000).toFixed(1)} s`);
    } else {
      job.status = "error";
      job.error = err?.message || String(err);
      job.phase = "Failed";
      console.error(`[ExportJobs] ${job.label} ${job.id} failed:`, err);
    }
  } finally {
    job.finishedAt = Date.now();
    job.run = null; // drop the closure (filters, report config)
    running = null;
    job.resolveDone();
    setImmediate(pump);
  }
}

/**
 * Queue an export. `run(filePath, update)` writes the .xlsx to filePath and may call
 * update({ progress 0–100, phase, rows }); it may return { rows }.
 */
function createJob({ userId, label = "export", fileName, run }) {
  if (queue.length >= MAX_QUEUED) {
    const err = new Error("Too many exports are waiting. Please try again in a few minutes.");
    err.statusCode = 429;
    throw err;
  }
  const id = crypto.randomUUID();
  const job = {
    id,
    userId: userId == null ? null : String(userId),
    label,
    fileName: fileName || `${label}.xlsx`,
    filePath: path.join(EXPORT_DIR, `${id}.xlsx`),
    status: "queued",
    progress: 0,
    phase: "Queued",
    rows: 0,
    error: null,
    fileSize: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    run,
  };
  job.done = new Promise((resolve) => { job.resolveDone = resolve; });
  jobs.set(id, job);
  queue.push(job);
  setImmediate(pump);
  return job;
}

/** The job, only for the user who created it (null otherwise). */
function getJob(id, userId) {
  const job = jobs.get(String(id || ""));
  if (!job) return null;
  if (job.userId !== (userId == null ? null : String(userId))) return null;
  return job;
}

/**
 * Cancel a job (owner only — pass a job from getJob). Queued: removed from the queue. Running: stops at the next
 * chunk / batch of rows (a few seconds at most) and its partial file is deleted. Finished: its file is deleted.
 */
function cancelJob(job) {
  if (!job) return null;
  if (job.status === "queued") {
    const i = queue.indexOf(job);
    if (i >= 0) queue.splice(i, 1);
    job.status = "cancelled";
    job.phase = "Cancelled";
    job.finishedAt = Date.now();
    job.run = null;
    job.resolveDone();
  } else if (job.status === "running") {
    job.cancelRequested = true;
    job.phase = "Cancelling…";
  } else if (job.status === "done") {
    if (job.deleteTimer) clearTimeout(job.deleteTimer);
    unlinkQuiet(job.filePath);
    job.fileDeleted = true;
    job.status = "cancelled";
    job.phase = "Cancelled";
  }
  return job;
}

/** Remove the file a little after it was downloaded (a second click within the grace period still works). */
function scheduleFileDeletion(job, delayMs = DELETE_AFTER_DOWNLOAD_MS) {
  if (job.deleteTimer) return;
  job.deleteTimer = setTimeout(() => {
    unlinkQuiet(job.filePath);
    job.fileDeleted = true;
    job.phase = "File removed after download";
  }, delayMs);
  job.deleteTimer.unref?.();
}

/** Delete export files older than 1 hour and forget finished jobs older than that. */
async function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > MAX_AGE_MS) {
      unlinkQuiet(job.filePath);
      job.fileDeleted = true;
      jobs.delete(id);
    }
  }
  try {
    const names = await fs.promises.readdir(EXPORT_DIR);
    await Promise.all(names.map(async (name) => {
      const file = path.join(EXPORT_DIR, name);
      if (running && running.filePath === file) return;
      const st = await fs.promises.stat(file).catch(() => null);
      if (st && now - st.mtimeMs > MAX_AGE_MS) await fs.promises.unlink(file).catch(() => {});
    }));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("[ExportJobs] sweep failed:", err.message);
  }
}
const sweepTimer = setInterval(() => { sweep(); }, 10 * 60 * 1000);
sweepTimer.unref?.();
setImmediate(() => { sweep(); });

module.exports = {
  createJob,
  getJob,
  cancelJob,
  estimateSeconds,
  publicView,
  scheduleFileDeletion,
  sweep,
  EXPORT_DIR,
};
