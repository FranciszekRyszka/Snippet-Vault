"use client";

import { useSyncExternalStore } from "react";
import { syncNow, type SyncResult } from "@/lib/tauri-api";

// Shared sync status so the header indicator, the startup sync, and the Settings
// dialog all reflect the same live state — a sync started anywhere shows a
// spinner everywhere, and the last-synced time is remembered across launches.
//
// Sync is desktop-only (syncNow throws in the browser); on the web the header
// never shows the indicator, so this store just stays idle.

export type SyncStatus = "idle" | "syncing" | "error";

export type SyncState = {
  status: SyncStatus;
  // Epoch ms of the last successful sync, or null if never synced on this install.
  lastSyncedAt: number | null;
  // Message from the most recent failed sync (for the indicator's tooltip).
  error: string | null;
};

const STORAGE_KEY = "snipvault:lastSync";

function readLastSynced(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

let state: SyncState = {
  status: "idle",
  lastSyncedAt: readLastSynced(),
  error: null,
};

// Stable snapshot used during server render / static prerender, where there is
// no localStorage. Keeps useSyncExternalStore's server snapshot referentially
// stable (the indicator itself only renders client-side, after a server is
// found, so this never causes a visible hydration mismatch).
const SERVER_STATE: SyncState = { status: "idle", lastSyncedAt: null, error: null };

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  emit();
}

// Run a sync, wrapping it with the shared status + persisted last-synced time.
// Rethrows on failure so existing callers keep their own error UI; the store
// also records the error for the header tooltip.
export async function runSync(): Promise<SyncResult> {
  setState({ status: "syncing", error: null });
  try {
    const result = await syncNow();
    const now = Date.now();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // storage blocked — the in-memory time still updates for this session
    }
    setState({ status: "idle", lastSyncedAt: now });
    return result;
  } catch (err) {
    setState({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// Whether a sync is currently in flight — used by background auto-sync to skip a
// tick that would overlap a startup/manual sync already running.
export function isSyncing(): boolean {
  return state.status === "syncing";
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useSyncStore(): SyncState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE
  );
}
