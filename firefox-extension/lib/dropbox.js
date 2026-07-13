// ── dropbox.js ── Dropbox OAuth (PKCE) + file API ─────────────────────────────
//
// No client secret is required.  Uses the Authorization Code + PKCE flow so
// everything stays in the browser.
//
// Setup (one-time, ~5 min):
//   1. Go to https://www.dropbox.com/developers/apps/create
//   2. Choose "Scoped access" → "App folder"
//   3. Give it a name (e.g. "side-notes")
//   4. Under "OAuth 2" → "Redirect URIs" add the exact URL you open the app at
//      (e.g. https://yourdomain.com/ or https://you.github.io/side-notes/)
//   5. Copy the "App key" — that's all you need.

const AUTH_ENDPOINT     = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_ENDPOINT    = 'https://api.dropboxapi.com/oauth2/token';
const DOWNLOAD_ENDPOINT = 'https://content.dropboxapi.com/2/files/download';
const UPLOAD_ENDPOINT   = 'https://content.dropboxapi.com/2/files/upload';

export const SYNC_FILE = '/side-notes-data.json';

const VERIFIER_KEY = 'sn-pkce-verifier';

// ── PKCE helpers ───────────────────────────────────────────────────────────────

function generateVerifier() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function sha256Base64url(str) {
    const bytes = new TextEncoder().encode(str);
    const hash  = await crypto.subtle.digest('SHA-256', bytes);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── OAuth flow ─────────────────────────────────────────────────────────────────

/** Redirects the browser to Dropbox's authorization page. */
export async function startOAuth(appKey) {
    const verifier   = generateVerifier();
    const challenge  = await sha256Base64url(verifier);
    const redirectUri = window.location.origin + window.location.pathname;

    sessionStorage.setItem(VERIFIER_KEY, verifier);

    const params = new URLSearchParams({
        client_id:             appKey,
        response_type:         'code',
        redirect_uri:          redirectUri,
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        token_access_type:     'offline',   // requests a refresh token
    });
    window.location.href = `${AUTH_ENDPOINT}?${params}`;
}

/**
 * Call this on every page load.  If the URL contains `?code=`, the function
 * completes the PKCE exchange and returns token data.  Otherwise returns null.
 *
 * @returns {{ accessToken, refreshToken, expiry } | null}
 */
export async function handleOAuthCallback(appKey) {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const error  = params.get('error');

    if (error) {
        history.replaceState(null, '', window.location.pathname);
        throw new Error(`Dropbox auth error: ${error}`);
    }
    if (!code) return null;

    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    history.replaceState(null, '', window.location.pathname);

    if (!verifier) throw new Error('PKCE verifier missing — please try connecting again');

    const redirectUri = window.location.origin + window.location.pathname;
    const resp = await fetch(TOKEN_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            grant_type:    'authorization_code',
            client_id:     appKey,
            code_verifier: verifier,
            redirect_uri:  redirectUri,
        }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error_description ?? `Token exchange failed (${resp.status})`);
    }
    const data = await resp.json();
    return {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiry:       data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    };
}

// ── Token refresh ──────────────────────────────────────────────────────────────

export async function refreshAccessToken(appKey, oldRefreshToken) {
    const resp = await fetch(TOKEN_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: oldRefreshToken,
            client_id:     appKey,
        }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw Object.assign(
            new Error(err.error_description ?? `Token refresh failed (${resp.status})`),
            { code: resp.status }
        );
    }
    const data = await resp.json();
    return {
        accessToken: data.access_token,
        expiry:      data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    };
}

// ── Dropbox file API ───────────────────────────────────────────────────────────

/**
 * Downloads the sync file from Dropbox.
 * Returns null if the file doesn't exist yet (first sync from this account).
 */
export async function fetchRemote(accessToken) {
    const resp = await fetch(DOWNLOAD_ENDPOINT, {
        headers: {
            'Authorization':   `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({ path: SYNC_FILE }),
        },
    });
    // 409 = file not found in Dropbox app folder
    if (resp.status === 409) return null;
    if (resp.status === 401) throw Object.assign(new Error('Unauthorized'), { code: 401 });
    if (!resp.ok) throw new Error(`Dropbox download failed (${resp.status})`);
    return resp.json().catch(() => null);
}

/** Uploads (overwrites) the sync file in Dropbox. */
export async function pushRemote(accessToken, payload) {
    const resp = await fetch(UPLOAD_ENDPOINT, {
        method:  'POST',
        headers: {
            'Authorization':    `Bearer ${accessToken}`,
            'Dropbox-API-Arg':  JSON.stringify({
                path:       SYNC_FILE,
                mode:       'overwrite',
                autorename: false,
                mute:       true,
            }),
            'Content-Type': 'application/octet-stream',
        },
        body: JSON.stringify(payload),
    });
    if (resp.status === 401) throw Object.assign(new Error('Unauthorized'), { code: 401 });
    if (!resp.ok) throw new Error(`Dropbox upload failed (${resp.status})`);
}
