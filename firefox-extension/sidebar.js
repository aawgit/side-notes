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
import { performSync, initSync } from './lib/sync.js';
import { handleOAuthCallback } from './lib/dropbox.js';

// ── State ──────────────────────────────────────────────────────────────────────

let groups   = loadGroups();
let dragging = null; // { groupId, todoId }
let currentTab = 'current'; // 'current' or 'week'

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
    render();
}

function addTodo(groupId, text, day = null) {
    if (!text.trim()) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    group.todos.unshift({
        id:            crypto.randomUUID(),
        text,
        day,
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
        input.placeholder = 'Add to this day...';
        input.addEventListener('keypress', e => {
            if (e.key === 'Enter') { 
                addTodoToDay(day, input.value); 
                input.value = ''; 
            }
        });

        const btn = document.createElement('button');
        btn.className = 'add';
        btn.textContent = 'Add';
        btn.onclick = () => { 
            addTodoToDay(day, input.value); 
            input.value = ''; 
        };

        addInput.appendChild(input);
        addInput.appendChild(btn);
        todoList.appendChild(addInput);

        todos.forEach(todo => {
            const todoEl = document.createElement('div');
            todoEl.className = 'week-todo';

            const text = document.createElement('span');
            text.className = 'week-todo-text';
            text.textContent = todo.text;

            const actions = document.createElement('div');
            actions.className = 'week-todo-actions';

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

    let targetGroup = groups.find(g => g.title === 'Notes') || groups[0];
    if (!targetGroup) {
        targetGroup = {
            id:            crypto.randomUUID(),
            title:         'Notes',
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
        day,
        _lastModified: Date.now(),
        _deviceId:     getDeviceId(),
    });
    save();
    render();
}

function render() {
    renderTabNavigation();
    if (currentTab === 'current') {
        renderCurrentView();
    } else {
        renderWeekView();
    }
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

// ── Startup ────────────────────────────────────────────────────────────────────

async function boot() {
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
