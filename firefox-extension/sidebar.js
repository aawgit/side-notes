import {
    loadGroups,
    saveGroups,
    getDeviceId,
    trackDeletedId,
    getSyncMeta,
    setSyncMeta,
    isNewDay,
    setLastKnownDay,
    getCurrentDay,
    movePastTodosToToday,
} from './lib/store.js';
import { hydrateAppVersion } from './lib/version.js';
import { performSync, initSync, scheduleSyncAfterEdit } from './lib/sync.js';
import { handleOAuthCallback } from './lib/dropbox.js';

// ── State ──────────────────────────────────────────────────────────────────────

let groups   = loadGroups();
let dragging = null; // { groupId, todoId }
let currentTab = 'current'; // 'current' or 'week'
let pendingSyncedGroups = null;
let activeDescriptionTarget = null; // { groupId, todoId }
let activeDescriptionInitialValue = '';

migrateLegacyDayGroups();

// ── Persistence ────────────────────────────────────────────────────────────────

function save() {
    saveGroups(groups);
}

function migrateLegacyDayGroups() {
    const remaining = [];

    groups.forEach((group) => {
        if (group.title && /^Day:\s/.test(group.title)) {
            const day = group.title.replace(/^Day:\s/, '').trim();
            const target = remaining.find(g => g.title === 'Notes') || remaining[0] || {
                id:            crypto.randomUUID(),
                title:         'Notes',
                todos:         [],
                collapsed:     false,
                _lastModified: Date.now(),
                _deviceId:     getDeviceId(),
            };

            if (!remaining.includes(target)) {
                remaining.push(target);
            }

            (group.todos || []).forEach(todo => {
                target.todos.push({
                    ...todo,
                    day: todo.day || day,
                    _lastModified: todo._lastModified || Date.now(),
                    _deviceId:     todo._deviceId || getDeviceId(),
                });
            });
            return;
        }

        remaining.push(group);
    });

    groups = remaining;
    save();
}

// ── Day management ─────────────────────────────────────────────────────────────

function formatDate(date) {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getNextDays(count = 7) {
    const days = [];
    for (let i = 0; i < count; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        days.push(formatDate(d));
    }
    return days;
}

function formatDateForDisplay(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dateObj = new Date(dateStr + 'T00:00:00');
    const isToday = dateObj.toDateString() === today.toDateString();
    const isTomorrow = dateObj.toDateString() === tomorrow.toDateString();
    
    if (isToday) return 'Today';
    if (isTomorrow) return 'Tomorrow';
    
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getTodosForDay(day) {
    const result = [];
    groups.forEach(group => {
        group.todos.forEach(todo => {
            if (todo.day === day) {
                result.push({ ...todo, groupId: group.id });
            }
        });
    });
    return result;
}

function setTodoDay(groupId, todoId, day) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    const todo = group.todos.find(t => t.id === todoId);
    if (!todo) return;
    
    todo.day = day;
    todo._lastModified = Date.now();
    save();
    scheduleSyncAfterEdit();
    render();
}

function moveNotesFromOldDays() {
    const today = getCurrentDay();
    let changed = false;

    groups.forEach(group => {
        (group.todos || []).forEach(todo => {
            if (todo.day && todo.day < today) {
                todo.day = today;
                todo._lastModified = Date.now();
                changed = true;
            }
        });
    });

    if (changed) {
        save();
    }
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
    scheduleSyncAfterEdit();
    render();
}

function addTodo(groupId, text, day = null) {
    if (!text.trim()) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    group.todos.unshift({
        id:            crypto.randomUUID(),
        text,
        description:   '',
        day,
        _lastModified: Date.now(),
        _deviceId:     getDeviceId(),
    });
    save();
    scheduleSyncAfterEdit();
    render();
}

function deleteTodo(groupId, todoId) {
    if (
        activeDescriptionTarget &&
        activeDescriptionTarget.groupId === groupId &&
        activeDescriptionTarget.todoId === todoId
    ) {
        closeDescriptionEditor();
    }

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
    scheduleSyncAfterEdit();
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
    scheduleSyncAfterEdit();
    render();
}

function getTodoRef(groupId, todoId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return null;
    const todo = (group.todos || []).find(t => t.id === todoId);
    if (!todo) return null;
    return { group, todo };
}

function ensureDescriptionEditor() {
    let backdrop = document.getElementById('descriptionEditorBackdrop');
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = 'descriptionEditorBackdrop';
    backdrop.className = 'description-editor-backdrop';

    const panel = document.createElement('div');
    panel.className = 'description-editor-panel';

    const title = document.createElement('div');
    title.id = 'descriptionEditorTitle';
    title.className = 'description-editor-title';

    const textarea = document.createElement('textarea');
    textarea.id = 'descriptionEditorInput';
    textarea.className = 'description-editor-input';
    textarea.placeholder = 'Add note description...';
    textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDescriptionEditor();
        }
    });

    const actions = document.createElement('div');
    actions.className = 'description-editor-actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'add';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => closeDescriptionEditor());

    const saveCloseBtn = document.createElement('button');
    saveCloseBtn.id = 'descriptionEditorSaveCloseBtn';
    saveCloseBtn.type = 'button';
    saveCloseBtn.className = 'add';
    saveCloseBtn.textContent = 'Save & Close';
    saveCloseBtn.disabled = true;
    saveCloseBtn.addEventListener('click', () => saveDescriptionAndClose());

    textarea.addEventListener('input', () => {
        updateDescriptionSaveButtonState();
    });

    actions.appendChild(closeBtn);
    actions.appendChild(saveCloseBtn);

    panel.appendChild(title);
    panel.appendChild(textarea);
    panel.appendChild(actions);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    return backdrop;
}

function updateDescriptionSaveButtonState() {
    const textarea = document.getElementById('descriptionEditorInput');
    const saveCloseBtn = document.getElementById('descriptionEditorSaveCloseBtn');
    if (!textarea || !saveCloseBtn) return;
    saveCloseBtn.disabled = textarea.value === activeDescriptionInitialValue;
}

function openDescriptionEditor(groupId, todoId) {
    const todoRef = getTodoRef(groupId, todoId);
    if (!todoRef) return;

    activeDescriptionTarget = { groupId, todoId };
    const backdrop = ensureDescriptionEditor();
    const title = document.getElementById('descriptionEditorTitle');
    const textarea = document.getElementById('descriptionEditorInput');
    if (!title || !textarea) return;

    title.textContent = todoRef.todo.text;
    textarea.value = todoRef.todo.description || '';
    activeDescriptionInitialValue = textarea.value;
    backdrop.classList.add('is-open');
    updateDescriptionSaveButtonState();

    // Make the editor's text area the primary focus target.
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
}

function closeDescriptionEditor() {
    const backdrop = document.getElementById('descriptionEditorBackdrop');
    if (backdrop) backdrop.classList.remove('is-open');
    activeDescriptionTarget = null;
    activeDescriptionInitialValue = '';
}

function saveDescriptionAndClose() {
    if (!activeDescriptionTarget) return;

    const textarea = document.getElementById('descriptionEditorInput');
    if (!textarea) return;

    const todoRef = getTodoRef(activeDescriptionTarget.groupId, activeDescriptionTarget.todoId);
    if (!todoRef) {
        closeDescriptionEditor();
        return;
    }

    const nextDescription = textarea.value;
    const currentDescription = todoRef.todo.description || '';

    if (nextDescription !== currentDescription) {
        todoRef.todo.description = nextDescription;
        todoRef.todo._lastModified = Date.now();
        save();
        scheduleSyncAfterEdit();
    }
    closeDescriptionEditor();
}

// ── Render ─────────────────────────────────────────────────────────────────────

function renderTabNavigation() {
    let tabNav = document.getElementById('tabNavigation');
    if (!tabNav) {
        tabNav = document.createElement('div');
        tabNav.id = 'tabNavigation';
        tabNav.className = 'tab-navigation';
        const container = document.getElementById('groupsContainer');
        container.parentElement.insertBefore(tabNav, container);
    }
    
    tabNav.innerHTML = '';
    
    const currentBtn = document.createElement('button');
    currentBtn.className = `tab-button ${currentTab === 'current' ? 'active' : ''}`;
    currentBtn.textContent = 'All';
    currentBtn.onclick = () => {
        currentTab = 'current';
        render();
    };
    tabNav.appendChild(currentBtn);
    
    const weekBtn = document.createElement('button');
    weekBtn.className = `tab-button ${currentTab === 'week' ? 'active' : ''}`;
    weekBtn.textContent = 'Next 7 Days';
    weekBtn.onclick = () => {
        currentTab = 'week';
        render();
    };
    tabNav.appendChild(weekBtn);
}

function renderCurrentView() {
    const container = document.getElementById('groupsContainer');
    container.innerHTML = '';

    groups.forEach((group) => {
        // Skip hidden groups (starting with __)
        if (group.title.startsWith('__')) return;
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
            scheduleSyncAfterEdit();
            render();
        };
        g.appendChild(header);

        if (!group.collapsed) {
            const list = document.createElement('div');
            list.className = 'todo-list';

            const addInput = document.createElement('div');
            addInput.className = 'add-todo-input';

            const input = document.createElement('input');
            input.dataset.draftKey = `group:${groupId}`;
            input.placeholder = 'Add todo...';
            input.addEventListener('keypress', e => {
                if (e.key === 'Enter') {
                    const text = input.value;
                    input.value = '';
                    addTodo(groupId, text);
                }
            });

            const btn = document.createElement('button');
            btn.className = 'add';
            btn.textContent = 'Add';
            btn.onclick = () => {
                const text = input.value;
                input.value = '';
                addTodo(groupId, text);
            };

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
                wrapper.addEventListener('click', () => {
                    openDescriptionEditor(groupId, todoId);
                });

                const textSpan = document.createElement('span');
                textSpan.className   = 'note-text';
                textSpan.textContent = todo.text;

                const actions = document.createElement('div');
                actions.className = 'note-actions';
                actions.addEventListener('click', (e) => {
                    e.stopPropagation();
                });

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

                const daySelect = document.createElement('select');
                daySelect.className = 'day-select';
                daySelect.addEventListener('change', (e) => {
                    setTodoDay(groupId, todoId, e.target.value || null);
                });

                const noneOption = document.createElement('option');
                noneOption.value = '';
                noneOption.textContent = 'No day';
                daySelect.appendChild(noneOption);

                getNextDays(7).forEach(day => {
                    const option = document.createElement('option');
                    option.value = day;
                    option.textContent = formatDateForDisplay(day);
                    daySelect.appendChild(option);
                });

                daySelect.value = todo.day || '';

                actions.appendChild(daySelect);
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

function renderWeekView() {
    const container = document.getElementById('groupsContainer');
    container.innerHTML = '';

    const weekView = document.createElement('div');
    weekView.className = 'week-view';

    getNextDays(7).forEach(day => {
        const todos = getTodosForDay(day);
        
        const dayCard = document.createElement('div');
        dayCard.className = 'day-card';

        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.textContent = formatDateForDisplay(day);
        dayCard.appendChild(dayHeader);

        const todoList = document.createElement('div');
        todoList.className = 'day-todos';

        const addInput = document.createElement('div');
        addInput.className = 'add-todo-input';

        const input = document.createElement('input');
        input.dataset.draftKey = `day:${day}`;
        input.placeholder = 'Add to this day...';
        input.addEventListener('keypress', e => {
            if (e.key === 'Enter') { 
                const text = input.value;
                input.value = '';
                addTodoToDay(day, text);
            }
        });

        const btn = document.createElement('button');
        btn.className = 'add';
        btn.textContent = 'Add';
        btn.onclick = () => { 
            const text = input.value;
            input.value = '';
            addTodoToDay(day, text);
        };

        addInput.appendChild(input);
        addInput.appendChild(btn);
        todoList.appendChild(addInput);

        todos.forEach(todo => {
            const todoEl = document.createElement('div');
            todoEl.className = 'week-todo';
            todoEl.addEventListener('click', () => {
                openDescriptionEditor(todo.groupId, todo.id);
            });

            const text = document.createElement('span');
            text.className = 'week-todo-text';
            text.textContent = todo.text;

            const actions = document.createElement('div');
            actions.className = 'week-todo-actions';
            actions.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            const copyBtn = document.createElement('button');
            copyBtn.className = 'icon-button copy';
            copyBtn.textContent = '📋';
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(todo.text);
                    copyBtn.textContent = '✅';
                    setTimeout(() => { copyBtn.textContent = '📋'; }, 800);
                } catch (err) {
                    console.error('Clipboard copy failed', err);
                }
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'icon-button delete';
            deleteBtn.textContent = '🗑';
            deleteBtn.addEventListener('click', () => {
                deleteTodo(todo.groupId, todo.id);
            });

            actions.appendChild(copyBtn);
            actions.appendChild(deleteBtn);

            todoEl.appendChild(text);
            todoEl.appendChild(actions);
            todoList.appendChild(todoEl);
        });

        dayCard.appendChild(todoList);
        weekView.appendChild(dayCard);
    });

    container.appendChild(weekView);
}

function addTodoToDay(day, text) {
    if (!text.trim()) return;

    // Use a special hidden group for day-based notes so they don't appear in the "All" tab
    let targetGroup = groups.find(g => g.title === '__Day Notes__');
    if (!targetGroup) {
        targetGroup = {
            id:            crypto.randomUUID(),
            title:         '__Day Notes__',
            todos:         [],
            collapsed:     false,
            _lastModified: Date.now(),
            _deviceId:     getDeviceId(),
        };
        groups.unshift(targetGroup);
    }

    targetGroup.todos.unshift({
        id:            crypto.randomUUID(),
        text,
        description:   '',
        day,
        _lastModified: Date.now(),
        _deviceId:     getDeviceId(),
    });
    save();
    scheduleSyncAfterEdit();
    render();
}

function getDraftKey(input) {
    if (!input) return null;
    if (input.id === 'newTitle') return 'newTitle';
    return input.dataset.draftKey || null;
}

function captureDraftState() {
    const values = new Map();
    let focusedKey = null;
    let selectionStart = null;
    let selectionEnd = null;

    document.querySelectorAll('input').forEach((input) => {
        const key = getDraftKey(input);
        if (!key) return;
        values.set(key, input.value);

        if (document.activeElement === input) {
            focusedKey = key;
            selectionStart = input.selectionStart;
            selectionEnd = input.selectionEnd;
        }
    });

    return { values, focusedKey, selectionStart, selectionEnd };
}

function restoreDraftState(state) {
    if (!state) return;

    document.querySelectorAll('input').forEach((input) => {
        const key = getDraftKey(input);
        if (!key || !state.values.has(key)) return;
        input.value = state.values.get(key);

        if (key === state.focusedKey) {
            input.focus();
            if (
                Number.isInteger(state.selectionStart) &&
                Number.isInteger(state.selectionEnd)
            ) {
                input.setSelectionRange(state.selectionStart, state.selectionEnd);
            }
        }
    });
}

function applySyncedGroups(nextGroups) {
    if (!Array.isArray(nextGroups)) return;
    if (JSON.stringify(groups) === JSON.stringify(nextGroups)) return;
    groups = nextGroups;

    if (activeDescriptionTarget) {
        const stillExists = getTodoRef(activeDescriptionTarget.groupId, activeDescriptionTarget.todoId);
        if (!stillExists) closeDescriptionEditor();
    }

    render();
}

function isTypingIntoInput() {
    const el = document.activeElement;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

function render() {
    const draftState = captureDraftState();
    renderTabNavigation();
    if (currentTab === 'current') {
        renderCurrentView();
    } else {
        renderWeekView();
    }
    restoreDraftState(draftState);
}

// ── Event wiring ───────────────────────────────────────────────────────────────

document.getElementById('addTitleBtn').addEventListener('click', addGroup);
document.getElementById('newTitle').addEventListener('keypress', e => {
    if (e.key === 'Enter') addGroup();
});

// Re-render when a sync cycle delivers a merged state.
window.addEventListener('sn:synced', (e) => {
    const syncedGroups = e.detail?.groups;
    if (isTypingIntoInput()) {
        pendingSyncedGroups = syncedGroups;
        return;
    }

    pendingSyncedGroups = null;
    applySyncedGroups(syncedGroups);
});

window.addEventListener('focusin', () => {
    if (!pendingSyncedGroups || isTypingIntoInput()) return;
    const nextGroups = pendingSyncedGroups;
    pendingSyncedGroups = null;
    applySyncedGroups(nextGroups);
});

// ── Startup ────────────────────────────────────────────────────────────────────

async function boot() {
    hydrateAppVersion();

    // Check if it's a new day and move old notes
    if (isNewDay()) {
        moveNotesFromOldDays();
    }
    setLastKnownDay(getCurrentDay());
    
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
    }
}

boot();
