const REDDIT_STALE_MS       = 12 * 60 * 1000;  // 2.4× the 5-min interval
const GOOGLE_ALERTS_STALE_MS = 5  * 60 * 1000;  // 2.5× the 2-min interval

interface MonitorRecord {
  lastScan: Date | null;
  lastBusinessCount: number;
  staleThresholdMs: number;
}

const state: Record<string, MonitorRecord> = {
  reddit: {
    lastScan: null,
    lastBusinessCount: 0,
    staleThresholdMs: REDDIT_STALE_MS,
  },
  googleAlerts: {
    lastScan: null,
    lastBusinessCount: 0,
    staleThresholdMs: GOOGLE_ALERTS_STALE_MS,
  },
};

export function recordScan(monitor: "reddit" | "googleAlerts", businessCount: number): void {
  state[monitor].lastScan = new Date();
  state[monitor].lastBusinessCount = businessCount;
}

export function getMonitorHealth(monitoringEnabled: boolean): Record<string, {
  lastScan: string | null;
  healthy: boolean;
  disabled: boolean;
  businessCount: number;
}> {
  const now = Date.now();
  const result: Record<string, { lastScan: string | null; healthy: boolean; disabled: boolean; businessCount: number }> = {};

  for (const [name, rec] of Object.entries(state)) {
    const disabled = !monitoringEnabled;
    const lastScan = rec.lastScan ? rec.lastScan.toISOString() : null;
    const healthy = !disabled && (rec.lastScan !== null && (now - rec.lastScan.getTime()) < rec.staleThresholdMs);
    result[name] = { lastScan, healthy, disabled, businessCount: rec.lastBusinessCount };
  }

  return result;
}
