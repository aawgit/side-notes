// ── sync.js ── sync orchestration ──────────────────────────────────────────────
//
// Reads the latest local state from localStorage, merges with the remote
// Dropbox snapshot, saves the result locally, and pushes it back.
//
// Callers interact with this module via:
//   performSync()          – run one sync cycle immediately
//   scheduleSyncAfterEdit()– debounced trigger after a local edit (3 s)
//   startPeriodicSync()    – poll every 30 s while the app is open
//   onStatusChange(fn)     – subscribe to status updates for UI feedback
//   initSync()             – emit the correct initial status on startup

import {
    getSyncMeta, setSyncMeta,
    loadGroups, saveGroups,
    getDeviceId,
    getDeletedIds, mergeAndSaveDeletedIds,
} from './store.js';
import { mergeGroups }                           from './merge.js';
import { fetchRemote, pushRemote, refreshAccessToken } from './dropbox.js';

// ── Status enum ────────────────────────────────────────────────────────────────

export const Status = Object.freeze({
    DISCONNECTED: 'disconnected',
    SYNCING:      'syncing',
    OK:           'ok',
    ERROR:        'error',
});

// ── Internal state ─────────────────────────────────────────────────────────────

let _listeners    = [];
let _status       = Status.DISCONNECTED;
let _statusDetail = null;
let _debounceTimer  = null;
let _periodicTimer  = null;

// ── Status API ─────────────────────────────────────────────────────────────────

export function getStatus() {
    return { status: _status, detail: _statusDetail };
}

/**
 * Subscribe to status changes.
 * @param {(status: string, detail: any) => void} fn
 * @returns {() => void} unsubscribe function
 */
export function onStatusChange(fn) {
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(l => l !== fn); };
}

function emit(status, detail = null) {
    _status       = status;
    _statusDetail = detail;
    for (const fn of _listeners) fn(status, detail);
}

// ── Token management ───────────────────────────────────────────────────────────

async function getValidToken() {
    const meta = getSyncMeta();
    if (!meta.enabled || !meta.dropboxToken) throw new Error('Not configured');

    // Refresh if the token expires within the next 60 seconds
    if (meta.dropboxTokenExpiry && Date.now() > meta.dropboxTokenExpiry - 60_000) {
        if (!meta.dropboxRefreshToken) {
            setSyncMeta({ enabled: false, dropboxToken: null });
            throw Object.assign(
                new Error('Dropbox session expired — please reconnect'),
                { code: 'reauth' }
            );
        }
        const { accessToken, expiry } = await refreshAccessToken(
            meta.appKey, meta.dropboxRefreshToken
        );
        setSyncMeta({ dropboxToken: accessToken, dropboxTokenExpiry: expiry });
        return accessToken;
    }
    return meta.dropboxToken;
}

// ── Core sync ──────────────────────────────────────────────────────────────────

/** Run a full sync cycle.  Safe to call concurrently — overlapping calls are no-ops. */
let _syncing = false;
export async function performSync() {
    const meta = getSyncMeta();
    if (!meta.enabled || !meta.dropboxToken) return;
    if (_syncing) return;

    _syncing = true;
    emit(Status.SYNCING);
    try {
        const token  = await getValidToken();
        const remote = await fetchRemote(token);

        // Read local state *after* the network round-trip so we capture any
        // edits the user made while the download was in flight.
        const local = loadGroups();

        let finalGroups = local;
        if (remote?.groups) {
            const deletedIds = mergeAndSaveDeletedIds(remote.deletedIds ?? []);
            finalGroups = mergeGroups(local, remote.groups, deletedIds);
            saveGroups(finalGroups);
        }

        await pushRemote(token, {
            groups:     finalGroups,
            deletedIds: getDeletedIds(),
            deviceId:   getDeviceId(),
            syncedAt:   Date.now(),
        });

        setSyncMeta({ lastSync: Date.now() });
        emit(Status.OK, Date.now());

        // Notify the UI layer so it can re-render with the merged state.
        window.dispatchEvent(new CustomEvent('sn:synced', { detail: { groups: finalGroups } }));
    } catch (err) {
        console.error('[sn:sync]', err);
        if (err.code === 401 || err.code === 'reauth') {
            setSyncMeta({ enabled: false, dropboxToken: null, dropboxRefreshToken: null });
            emit(Status.DISCONNECTED);
            window.dispatchEvent(new Event('sn:auth-expired'));
        } else {
            emit(Status.ERROR, err.message);
        }
    } finally {
        _syncing = false;
    }
}

// ── Scheduling ─────────────────────────────────────────────────────────────────

/** Debounce: wait 3 s after the last edit before syncing. */
export function scheduleSyncAfterEdit() {
    if (!getSyncMeta().enabled) return;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => performSync().catch(() => {}), 3_000);
}

export function startPeriodicSync() {
    clearInterval(_periodicTimer);
    _periodicTimer = setInterval(() => performSync().catch(() => {}), 30_000);
}

export function stopPeriodicSync() {
    clearInterval(_periodicTimer);
    _periodicTimer = null;
}

/** Call once on startup to emit the correct initial status. */
export function initSync() {
    const meta = getSyncMeta();
    if (meta.enabled && meta.dropboxToken) {
        emit(meta.lastSync ? Status.OK : Status.SYNCING, meta.lastSync ?? null);
    } else {
        emit(Status.DISCONNECTED);
    }
}
