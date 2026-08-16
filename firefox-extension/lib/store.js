// ── store.js ── persistent state layer with sync metadata ──────────────────────
//
// All localStorage access goes through here so that both the web app and the
// Firefox extension read/write data identically.

const STORAGE_KEY     = 'todo-groups';
const DEVICE_ID_KEY   = 'sn-device-id';
const SYNC_META_KEY   = 'sn-sync-meta';
const DELETED_IDS_KEY = 'sn-deleted-ids';
const LAST_DAY_KEY    = 'sn-last-day';

// ── Device identity ────────────────────────────────────────────────────────────

export function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

// ── Migration helpers ──────────────────────────────────────────────────────────
// Adds stable IDs and sync metadata to items that pre-date sync support.

function migrateTodo(todo, deviceId, now) {
    return {
        id:            todo.id            ?? crypto.randomUUID(),
        text:          todo.text,
        description:   todo.description   ?? '',
        day:           todo.day           ?? null,
        _lastModified: todo._lastModified ?? now,
        _deviceId:     todo._deviceId     ?? deviceId,
    };
}

function migrateGroup(group, deviceId, now) {
    return {
        id:            group.id            ?? crypto.randomUUID(),
        title:         group.title,
        collapsed:     group.collapsed     ?? false,
        _lastModified: group._lastModified ?? now,
        _deviceId:     group._deviceId     ?? deviceId,
        todos: (group.todos ?? []).map(t => migrateTodo(t, deviceId, now)),
    };
}

// ── Groups ─────────────────────────────────────────────────────────────────────

export function loadGroups() {
    const deviceId = getDeviceId();
    const now = Date.now();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const groups = raw ? JSON.parse(raw) : [];
        return groups.map(g => migrateGroup(g, deviceId, now));
    } catch {
        return [];
    }
}

export function saveGroups(groups) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

// ── Sync metadata ──────────────────────────────────────────────────────────────

export function getSyncMeta() {
    try {
        const raw = localStorage.getItem(SYNC_META_KEY);
        return raw ? JSON.parse(raw) : {
            enabled:               false,
            appKey:                null,
            dropboxToken:          null,
            dropboxRefreshToken:   null,
            dropboxTokenExpiry:    null,
            lastSync:              null,
        };
    } catch {
        return { enabled: false };
    }
}

export function setSyncMeta(patch) {
    const current = getSyncMeta();
    localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...current, ...patch }));
}

// ── Deleted-ID tombstones ──────────────────────────────────────────────────────
// Tracks IDs of items deleted locally so that a sync merge never re-introduces
// them from a remote snapshot that hasn't caught up yet.

export function getDeletedIds() {
    try {
        const raw = localStorage.getItem(DELETED_IDS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function trackDeletedId(id) {
    if (!id) return;
    const ids = getDeletedIds();
    if (!ids.includes(id)) {
        ids.push(id);
        localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(ids));
    }
}

/**
 * Union of local + remote deleted-ID sets.  Saves the combined set locally and
 * returns it as an array so the caller can pass it straight into mergeGroups().
 */
export function mergeAndSaveDeletedIds(remoteIds) {
    const combined = new Set(getDeletedIds());
    for (const id of (remoteIds ?? [])) combined.add(id);
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...combined]));
    return [...combined];
}

// ── Day tracking ──────────────────────────────────────────────────────────────
// Tracks the last known day to detect when it's a new day, so notes can auto-move.

export function getDayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`; // YYYY-MM-DD in local time
}

export function movePastTodosToToday(groups, todayDay = getCurrentDay()) {
    return groups.map(group => ({
        ...group,
        todos: (group.todos ?? []).map(todo => ({
            ...todo,
            day: todo.day && todo.day < todayDay ? todayDay : todo.day,
        })),
    }));
}

export function getLastKnownDay() {
    return localStorage.getItem(LAST_DAY_KEY) || null;
}

export function setLastKnownDay(day) {
    localStorage.setItem(LAST_DAY_KEY, day);
}

export function getCurrentDay() {
    return getDayKey();
}

export function isNewDay() {
    const last = getLastKnownDay();
    const current = getCurrentDay();
    return last !== current;
}
