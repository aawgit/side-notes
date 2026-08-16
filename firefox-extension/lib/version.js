export const APP_VERSION = '0.2.0';
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

export function hydrateAppVersion(root = document) {
    const matches = root.querySelectorAll('.app-version');
    matches.forEach((el) => {
        el.textContent = APP_VERSION_LABEL;
    });
    return APP_VERSION_LABEL;
}
