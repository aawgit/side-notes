import { loadGroups, saveGroups, getDeviceId, trackDeletedId, getSyncMeta, setSyncMeta } from './lib/store.js';
import { performSync, scheduleSyncAfterEdit, startPeriodicSync, initSync } from './lib/sync.js';
import { handleOAuthCallback } from './lib/dropbox.js';

// ── State ──────────────────────────────────────────────────────────────────────

let groups   = loadGroups();
let dragging = null; // { groupId, todoId }

// ── Persistence ────────────────────────────────────────────────────────────────

function save() {
    saveGroups(groups);
    scheduleSyncAfterEdit();
}

// ── Mutations ──────────────────────────────────────────────────────────────────

function addGroup() {
    const input = document.getElementById('newTitle');
    const name  = input.value.trim();
    if (!name) return;

    groups.unshift({
        id:            crypto.randomUUID(),
        title:         name,
        todos:         [],
        collapsed:     false,
        _lastModified: Date.now(),
        _deviceId:     getDeviceId(),
    });
    input.value = '';
    save();
    render();
}

function addTodo(groupId, text) {
    if (!text.trim()) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    group.todos.unshift({
        id:            crypto.randomUUID(),
        text,
        _lastModified: Date.now(),
        _deviceId:     getDeviceId(),
    });
    save();
    render();
}

function deleteTodo(groupId, todoId) {
    const gi = groups.findIndex(g => g.id === groupId);
    if (gi === -1) return;

    const ti = groups[gi].todos.findIndex(t => t.id === todoId);
    if (ti === -1) return;

    trackDeletedId(todoId);
    groups[gi].todos.splice(ti, 1);

    if (groups[gi].todos.length === 0) {
        trackDeletedId(groups[gi].id);
        groups.splice(gi, 1);
    }

    save();
    render();
}

function moveTodo(groupId, todoId, direction) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const ti = group.todos.findIndex(t => t.id === todoId);
    const ni = ti + direction;
    if (ti === -1 || ni < 0 || ni >= group.todos.length) return;

    [group.todos[ti], group.todos[ni]] = [group.todos[ni], group.todos[ti]];
    save();
    render();
}

// ── Render ─────────────────────────────────────────────────────────────────────

function render() {
    const container = document.getElementById('groupsContainer');
    container.innerHTML = '';

    groups.forEach((group) => {
        const groupId = group.id;

        const g = document.createElement('div');
        g.className = 'group';

        const header = document.createElement('div');
        header.className = 'group-header';

        const titleEl = document.createElement('strong');
        titleEl.textContent = group.title;

        const arrowEl = document.createElement('span');
        arrowEl.textContent = group.collapsed ? '▼' : '▲';

        header.appendChild(titleEl);
        header.appendChild(arrowEl);

        header.onclick = () => {
            group.collapsed = !group.collapsed;
            save();
            render();
        };
        g.appendChild(header);

        if (!group.collapsed) {
            const list = document.createElement('div');
            list.className = 'todo-list';

            const addInput = document.createElement('div');
            addInput.className = 'add-todo-input';

            const input = document.createElement('input');
            input.placeholder = 'Add todo...';
            input.addEventListener('keypress', e => {
                if (e.key === 'Enter') { addTodo(groupId, input.value); input.value = ''; }
            });

            const btn = document.createElement('button');
            btn.className = 'add';
            btn.textContent = 'Add';
            btn.onclick = () => { addTodo(groupId, input.value); input.value = ''; };

            addInput.appendChild(input);
            addInput.appendChild(btn);
            list.appendChild(addInput);

            group.todos.forEach((todo) => {
                const todoId = todo.id;
                const item   = document.createElement('div');
                item.className = 'todo';
                item.draggable = true;
                let dragXStart = 0;

                item.ondragstart = () => {
                    dragging   = { groupId, todoId };
                    dragXStart = event.clientX;
                    item.classList.add('dragging');
                };

                item.ondrag = (event) => {
                    if (event.clientX === 0) return;
                    const deltaX = event.clientX - dragXStart;
                    item.style.transform = `translateX(${deltaX}px)`;
                    if (deltaX > 180) item.style.opacity = 0.5;
                };

                item.ondragend = (event) => {
                    item.classList.remove('dragging');
                    const deltaX = event.clientX - dragXStart;
                    item.style.transform = 'translateX(0)';
                    item.style.opacity   = 1;
                    if (deltaX > 150) { deleteTodo(groupId, todoId); return; }
                };

                item.ondragover = (e) => e.preventDefault();

                item.ondrop = () => {
                    if (!dragging) return;
                    const srcGroup = groups.find(g => g.id === dragging.groupId);
                    if (!srcGroup) return;
                    const srcIdx = srcGroup.todos.findIndex(t => t.id === dragging.todoId);
                    if (srcIdx === -1) return;

                    const [dragged] = srcGroup.todos.splice(srcIdx, 1);
                    const tgtGroup  = groups.find(g => g.id === groupId);
                    const tgtIdx    = tgtGroup.todos.findIndex(t => t.id === todoId);
                    tgtGroup.todos.splice(tgtIdx, 0, dragged);

                    if (srcGroup.todos.length === 0 && srcGroup.id !== groupId) {
                        trackDeletedId(srcGroup.id);
                        groups.splice(groups.indexOf(srcGroup), 1);
                    }

                    save();
                    render();
                };

                const wrapper = document.createElement('div');
                wrapper.className = 'note-item';

                const textSpan = document.createElement('span');
                textSpan.className   = 'note-text';
                textSpan.textContent = todo.text;

                const actions = document.createElement('div');
                actions.className = 'note-actions';

                const upBtn = document.createElement('button');
                upBtn.className   = 'icon-button up';
                upBtn.textContent = '⬆';
                upBtn.addEventListener('click', () => moveTodo(groupId, todoId, -1));

                const downBtn = document.createElement('button');
                downBtn.className   = 'icon-button down';
                downBtn.textContent = '⬇';
                downBtn.addEventListener('click', () => moveTodo(groupId, todoId, 1));

                const deleteBtn = document.createElement('button');
                deleteBtn.className   = 'icon-button delete';
                deleteBtn.textContent = '🗑';
                deleteBtn.addEventListener('click', () => deleteTodo(groupId, todoId));

                const copyBtn = document.createElement('button');
                copyBtn.className   = 'icon-button copy';
                copyBtn.textContent = '📋';
                copyBtn.title       = 'Copy to clipboard';
                copyBtn.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(todo.text);
                        copyBtn.textContent = '✅';
                        setTimeout(() => { copyBtn.textContent = '📋'; }, 800);
                    } catch (err) {
                        console.error('Clipboard copy failed', err);
                    }
                });

                actions.appendChild(upBtn);
                actions.appendChild(downBtn);
                actions.appendChild(copyBtn);
                actions.appendChild(deleteBtn);

                wrapper.appendChild(textSpan);
                wrapper.appendChild(actions);
                item.appendChild(wrapper);
                list.appendChild(item);
            });

            g.appendChild(list);
        }

        container.appendChild(g);
    });
}

// ── Event wiring ───────────────────────────────────────────────────────────────

document.getElementById('addTitleBtn').addEventListener('click', addGroup);
document.getElementById('newTitle').addEventListener('keypress', e => {
    if (e.key === 'Enter') addGroup();
});

// Re-render when a sync cycle delivers a merged state.
window.addEventListener('sn:synced', (e) => {
    groups = e.detail.groups;
    render();
});

// Sync when the user returns to the tab / app (covers mobile backgrounding).
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') performSync().catch(() => {});
});

// ── Startup ────────────────────────────────────────────────────────────────────

async function boot() {
    // Complete an OAuth redirect if Dropbox sent us back with a code.
    const meta = getSyncMeta();
    if (window.location.search.includes('code=') && meta.appKey) {
        try {
            const tokens = await handleOAuthCallback(meta.appKey);
            if (tokens) {
                setSyncMeta({
                    enabled:             true,
                    dropboxToken:        tokens.accessToken,
                    dropboxRefreshToken: tokens.refreshToken,
                    dropboxTokenExpiry:  tokens.expiry,
                });
                window.dispatchEvent(new Event('sn:auth-complete'));
            }
        } catch (err) {
            console.error('[sn:boot] OAuth error:', err);
            window.dispatchEvent(new CustomEvent('sn:auth-error', { detail: err.message }));
        }
    }

    render();
    initSync();

    const cfg = getSyncMeta();
    if (cfg.enabled && cfg.dropboxToken) {
        await performSync().catch(() => {});
        startPeriodicSync();
    }
}

boot();

