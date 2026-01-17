/**
 * Debug utility for DM-related services (gift-wrap, NIP-17)
 * Enable verbose logging with: localStorage.setItem('grimoire:debug:dms', 'true')
 */

const DM_DEBUG_KEY = "grimoire:debug:dms";

/** Check if DM debug logging is enabled */
function isDMDebugEnabled(): boolean {
  try {
    return localStorage.getItem(DM_DEBUG_KEY) === "true";
  } catch {
    return false;
  }
}

/** Enable DM debug logging */
export function enableDMDebug() {
  localStorage.setItem(DM_DEBUG_KEY, "true");
  console.log("[DM Debug] Verbose logging enabled");
}

/** Disable DM debug logging */
export function disableDMDebug() {
  localStorage.removeItem(DM_DEBUG_KEY);
  console.log("[DM Debug] Verbose logging disabled");
}

/** Log debug message (only if debug enabled) */
export function dmDebug(component: string, message: string, ...args: any[]) {
  if (isDMDebugEnabled()) {
    console.log(`[${component}] ${message}`, ...args);
  }
}

/** Log info message (always shown, but only for important info) */
export function dmInfo(component: string, message: string, ...args: any[]) {
  console.info(`[${component}] ${message}`, ...args);
}

/** Log warning message (always shown) */
export function dmWarn(component: string, message: string, ...args: any[]) {
  console.warn(`[${component}] ⚠️ ${message}`, ...args);
}

/** Log error message (always shown) */
export function dmError(component: string, message: string, ...args: any[]) {
  console.error(`[${component}] ❌ ${message}`, ...args);
}

/** Log success message (only if debug enabled) */
export function dmSuccess(component: string, message: string, ...args: any[]) {
  if (isDMDebugEnabled()) {
    console.log(`[${component}] ✅ ${message}`, ...args);
  }
}
