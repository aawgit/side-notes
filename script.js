let groups = JSON.parse(localStorage.getItem("todo-groups") || "[]");
let dragging = null;

function save() {
    localStorage.setItem("todo-groups", JSON.stringify(groups));
}

function addGroup() {
    const input = document.getElementById("newTitle");
    const name = input.value.trim();
    if (!name) return;

    groups.push({ title: name, todos: [], collapsed: false });
    input.value = "";
    save();
    render();
}

document.getElementById("addTitleBtn").onclick = addGroup;
document.getElementById("newTitle").addEventListener("keypress", e => {
    if (e.key === "Enter") addGroup();
});

function addTodo(groupIndex, text) {
    if (!text.trim()) return;

    groups[groupIndex].todos.push({ text });
    save();
    render();
}

function deleteTodo(groupIndex, todoIndex) {
    groups[groupIndex].todos.splice(todoIndex, 1);

    if (groups[groupIndex].todos.length === 0) {
        groups.splice(groupIndex, 1);  // auto delete group
    }

    save();
    render();
}

function moveTodo(groupIndex, todoIndex, direction) {
    const arr = groups[groupIndex].todos;
    const newIndex = todoIndex + direction;
    if (newIndex < 0 || newIndex >= arr.length) return;

    [arr[todoIndex], arr[newIndex]] = [arr[newIndex], arr[todoIndex]];
    save();
    render();
}

function render() {
    const container = document.getElementById("groupsContainer");
    container.innerHTML = "";

    groups.forEach((group, gi) => {
        const g = document.createElement("div");
        g.className = "group";

        const header = document.createElement("div");
        header.className = "group-header";
        header.innerHTML = `<strong>${group.title}</strong> <span>${group.collapsed ? "▼" : "▲"}</span>`;
        header.onclick = () => {
            group.collapsed = !group.collapsed;
            save();
            render();
        };
        g.appendChild(header);

        if (!group.collapsed) {
            const list = document.createElement("div");
            list.className = "todo-list";

            group.todos.forEach((todo, ti) => {
                const item = document.createElement("div");
                item.className = "todo";
                item.draggable = true;

                let dragXStart = 0;

                item.ondragstart = () => {
                    dragging = { gi, ti };
                    dragXStart = event.clientX;
                    item.classList.add("dragging");
                };

                item.ondrag = (event) => {
                    if (event.clientX === 0) return;
                    let deltaX = event.clientX - dragXStart;
                    item.style.transform = `translateX(${deltaX}px)`;
                    if (deltaX > 180) item.style.opacity = 0.5;  // visual delete hint
                };

                item.ondragend = (event) => {
                    item.classList.remove("dragging");
                    let deltaX = event.clientX - dragXStart;

                    item.style.transform = "translateX(0)";
                    item.style.opacity = 1;

                    if (deltaX > 150) {
                        deleteTodo(gi, ti); // delete when dragged right
                        return;
                    }
                };

                item.ondragover = (e) => e.preventDefault();
                item.ondrop = (e) => {
                    const dragged = groups[dragging.gi].todos[dragging.ti];
                    groups[dragging.gi].todos.splice(dragging.ti, 1);
                    groups[gi].todos.splice(ti, 0, dragged);

                    // Cleanup if previous group empty
                    if (groups[dragging.gi].todos.length === 0) {
                        groups.splice(dragging.gi, 1);
                    }

                    save();
                    render();
                };

                item.innerHTML = `
                    <span>${todo.text}</span>
                    <span class="controls">
                        <button onclick="moveTodo(${gi}, ${ti}, -1)">⬆</button>
                        <button onclick="moveTodo(${gi}, ${ti}, 1)">⬇</button>
                        <button onclick="deleteTodo(${gi}, ${ti})">🗑</button>
                    </span>
                `;

                list.appendChild(item);
            });

            const addInput = document.createElement("div");
            addInput.className = "add-todo-input";

            const input = document.createElement("input");
            input.placeholder = "Add todo...";
            input.addEventListener("keypress", e => {
                if (e.key === "Enter") {
                    addTodo(gi, input.value);
                    input.value = "";
                }
            });

            const btn = document.createElement("button");
            btn.className = "add";
            btn.textContent = "Add";
            btn.onclick = () => {
                addTodo(gi, input.value);
                input.value = "";
            };

            addInput.appendChild(input);
            addInput.appendChild(btn);
            list.appendChild(addInput);
            g.appendChild(list);
        }

        container.appendChild(g);
    });
}

render();

