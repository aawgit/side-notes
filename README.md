# Side Notes (Web & Extension)

**Side Notes** is a minimal, local-first todo list application that functions seamlessly as both a **Firefox Sidebar Extension** and a standalone **Responsive Web App**.

It is designed for simplicity, speed, and privacy, using `localStorage` to persist your data entirely on your device.

## Features

- **📂 Grouping**: Organize your tasks into collapsible groups.
- **✋ Drag & Drop**: Reorder items within lists and drag them between groups.
- **📱 Responsive**: Optimized for both desktop sidebars and mobile web browsers.
- **🔒 Local-First**: No servers, no accounts. All data stays in your browser's `localStorage`.
- **📋 Clipboard Integration**: Detailed copy-to-clipboard functionality.
- **🗑️ Swipe Actions**: Visual feedback and swipe-to-delete gestures (Web/Mobile).

## How to Run

### 🌐 As a Web App
1. Clone or download this repository.
2. Open the `index.html` file in any modern web browser.
3. The app runs entirely offline.

### 🦊 As a Firefox Extension
1. Open Firefox and navigate to `about:debugging`.
2. Click on **"This Firefox"** in the sidebar.
3. Click **"Load Temporary Add-on..."**.
4. Navigate to the `firefox-extension/` directory inside this project.
5. Select the `manifest.json` file.
6. The extension will appear in your sidebar (View > Sidebar > Side Notes).

---

## Developer Guide

This section explains the technical architecture and development workflow for **Side Notes**.

### Architecture Overview

**Side Notes** uses a **hybrid architecture** to support both a Web App and a Firefox Extension with a single codebase for logic.

#### Code Sharing Strategy
- **Logic**: The core application logic stays in `firefox-extension/sidebar.js`. This file is the "Brain" of the application. It handles state management, local storage persistence, DOM rendering, and event listeners.
- **Entry Points**:
    - **Web App**: Uses `index.html` which imports the shared `firefox-extension/sidebar.js`.
    - **Extension**: Uses `firefox-extension/sidebar.html` which also imports `firefox-extension/sidebar.js`.

### File Structure

```
/
├── index.html                   # Entry point for the Web App (Development & Mobile)
├── styles.css                   # Main styles + Mobile/Responsive tweaks
├── firefox-extension/           # Extension-specific files
│   ├── manifest.json            # Firefox Extension configuration
│   ├── sidebar.html             # Entry point for the Extension Sidebar
│   ├── sidebar.js               # SHARED Logic (State, Rendering, Events)
│   ├── styles.css               # Extension-specific styles (Sidebar optimized)
│   └── icons/                   # App icons
└── README.md                    # Project documentation
```

### Key Components

#### `firefox-extension/sidebar.js`
This is where the magic happens. It manages the `groups` array in memory and syncs it with `localStorage`.
- **`render()`**: Refreshes the entire UI based on the current state.
- **`save()`**: Persists state to `localStorage`.
- **`drag & drop`**: Implements custom drag-and-drop logic for reordering and moving items.

#### Styles
- **`styles.css` (Root)**: Contains the full set of styles, including media queries for mobile devices (`max-width: 480px`). This is used by the Web App to ensure it looks good on phones.
- **`firefox-extension/styles.css`**: Contains styles optimized specifically for the narrow context of a browser sidebar.

### Development Workflow

1. **Modify Logic**: Edit `firefox-extension/sidebar.js`.
    - Changes immediately apply to both the Web App (on refresh) and the Extension (on reload).
2. **Modify Styles**:
    - If efficient for both, edit `styles.css`.
    - If specific to the sidebar, edit `firefox-extension/styles.css`.
3. **Testing**:
    - **Quick Loop**: Open `index.html` in a browser. This is the fastest way to test logic changes.
    - **Integration**: Reload the temporary add-on in Firefox to verify sidebar behavior.
