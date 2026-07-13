// ── merge.js ── last-write-wins merge for two group arrays ─────────────────────
//
// Both arrays must carry items with stable `id` and `_lastModified` fields
// (guaranteed by the migration in store.js).
//
// Strategy
//   • Groups are identified by `id`.  Local order is preserved; new groups
//     from the remote snapshot are prepended (they're newer additions).
//   • The same rule applies to todos within each group.
//   • Any id present in `deletedIds` is excluded from the result so that a
//     hard-delete on one device is not undone by the other device's snapshot.

/**
 * @param {object[]} local      - Current groups array from this device.
 * @param {object[]} remote     - Groups array from the Dropbox snapshot.
 * @param {string[]} deletedIds - Combined set of all deleted IDs (groups + todos).
 * @returns {object[]} Merged groups array.
 */
export function mergeGroups(local, remote, deletedIds = []) {
    const deleted = new Set(deletedIds);

    // Index remote groups by id (skip deleted ones)
    const remoteById = new Map(
        remote
            .filter(g => !deleted.has(g.id))
            .map(g => [g.id, g])
    );
    const localIds = new Set(local.map(g => g.id));

    // Update existing local groups (preserves local ordering)
    const updatedLocal = local
        .filter(g => !deleted.has(g.id))
        .map(lg => {
            const rg = remoteById.get(lg.id);
            if (!rg) return lg; // group only exists locally

            const useRemote = rg._lastModified > lg._lastModified;
            return {
                id:            lg.id,
                title:         useRemote ? rg.title     : lg.title,
                collapsed:     useRemote ? rg.collapsed : lg.collapsed,
                _lastModified: useRemote ? rg._lastModified : lg._lastModified,
                _deviceId:     useRemote ? rg._deviceId    : lg._deviceId,
                todos: _mergeTodos(lg.todos ?? [], rg.todos ?? [], deleted),
            };
        });

    // Prepend groups that exist only in the remote snapshot
    const newFromRemote = remote
        .filter(rg => !localIds.has(rg.id) && !deleted.has(rg.id))
        .map(rg => ({
            ...rg,
            todos: (rg.todos ?? []).filter(t => !deleted.has(t.id)),
        }));

    return [...newFromRemote, ...updatedLocal];
}

function _mergeTodos(local, remote, deleted) {
    const remoteById = new Map(
        remote
            .filter(t => !deleted.has(t.id))
            .map(t => [t.id, t])
    );
    const localIds = new Set(local.map(t => t.id));

    const updatedLocal = local
        .filter(t => !deleted.has(t.id))
        .map(lt => {
            const rt = remoteById.get(lt.id);
            if (!rt) return lt;
            return rt._lastModified > lt._lastModified ? rt : lt;
        });

    // Prepend todos that only exist in the remote snapshot
    const newFromRemote = remote.filter(rt => !localIds.has(rt.id) && !deleted.has(rt.id));

    return [...newFromRemote, ...updatedLocal];
}
