// Desktop auto-update helpers. All functions are no-ops in the browser build,
// so callers can use them unconditionally (guarded by isTauri where it matters).
import { isTauri } from "./tauri-api";

// Whether to automatically check for updates on startup. Stored as a plain UI
// preference in localStorage (default: enabled).
const AUTO_CHECK_KEY = "snipvault:autoUpdateCheck";

export function isAutoUpdateEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(AUTO_CHECK_KEY) !== "false";
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_CHECK_KEY, enabled ? "true" : "false");
}

export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return "";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

// A pending update the user can install. `install` downloads + applies it,
// reporting download progress as a percentage (or null when total size is
// unknown). After a successful install, call relaunchApp() to restart.
export type AvailableUpdate = {
  version: string;
  currentVersion: string;
  install: (onProgress?: (percent: number | null) => void) => Promise<void>;
};

// Guards against two install flows running at once. The update banner and the
// Settings dialog each hold their own AvailableUpdate handle, so without this a
// user could start a download from both and have two installs race the same
// installer. Shared at module scope so it spans every handle.
let installInProgress = false;

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    install: async (onProgress) => {
      if (installInProgress) {
        throw new Error("An update is already being installed.");
      }
      installInProgress = true;
      let total = 0;
      let downloaded = 0;
      try {
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              total = event.data.contentLength ?? 0;
              onProgress?.(total ? 0 : null);
              break;
            case "Progress":
              downloaded += event.data.chunkLength;
              onProgress?.(
                total ? Math.min(100, Math.round((downloaded / total) * 100)) : null
              );
              break;
            case "Finished":
              onProgress?.(100);
              break;
          }
        });
      } catch (err) {
        // Allow a retry after a failed install; on success the flag stays set
        // because the app is about to relaunch.
        installInProgress = false;
        throw err;
      }
    },
  };
}

export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
