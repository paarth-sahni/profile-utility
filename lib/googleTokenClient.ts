"use client";

/**
 * Purpose: the browser half of "Open in Google Docs": loads Google Identity Services and asks for a one-time
 * access token (drive.file) through Google's own consent popup. The token is handed straight back to the caller
 * and is never stored here (no variable outliving the call, no localStorage/cookie, no request to our server).
 * Two steps because popups need a user click: loadGoogleIdentity() on page load, then requestDriveToken() called
 * synchronously inside the click handler.
 */
import { DRIVE_SCOPE, GoogleDocsError, tokenHints } from "./googleDocs";

// The slice of Google's GIS token client this app uses (https://developers.google.com/identity/oauth2/web).
interface TokenResponse {
  access_token?: string;
  error?: string;
}
interface TokenClient {
  requestAccessToken: () => void;
}
interface GoogleOauth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    /** Which account should sign in (the app user's email) and its Workspace domain. */
    hint?: string;
    hd?: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }) => TokenClient;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOauth2 } };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
const LOAD_TIMEOUT_MS = 10_000;

/** The configured OAuth client id, or null when this environment has no Google Docs set up. */
export const GOOGLE_CLIENT_ID: string | null = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null;

const oauth2 = (): GoogleOauth2 | undefined => (typeof window === "undefined" ? undefined : window.google?.accounts?.oauth2);

let loading: Promise<void> | null = null;

/** Loads Google's sign-in script once (resolves at once if it is already there). Rejects with script_failed. */
export function loadGoogleIdentity(): Promise<void> {
  if (oauth2()) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      loading = null; // allow a retry
      script.remove();
      reject(new GoogleDocsError("script_failed"));
    };
    const timer = window.setTimeout(fail, LOAD_TIMEOUT_MS);
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      if (oauth2()) resolve();
      else fail();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      fail();
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** True once Google's script is ready, so requestDriveToken can be called inside a click. */
export const isGoogleIdentityReady = (): boolean => oauth2() !== undefined;

/**
 * Opens Google's consent popup and resolves with a short-lived access token for drive.file. `accountEmail` (the
 * app's signed-in user) tells Google which account to use, so the popup does not default to another Google account
 * of the browser. MUST be called synchronously from a click handler (before any `await`), or browsers block the popup.
 */
export function requestDriveToken(clientId: string, accountEmail?: string | null): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const api = oauth2();
    if (!api) {
      reject(new GoogleDocsError("script_failed"));
      return;
    }
    try {
      api
        .initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          ...tokenHints(accountEmail),
          callback: (response) => {
            if (response.access_token) resolve(response.access_token);
            else reject(new GoogleDocsError("access_denied"));
          },
          error_callback: (error) => {
            if (error.type === "popup_failed_to_open") reject(new GoogleDocsError("popup_blocked"));
            else if (error.type === "popup_closed") reject(new GoogleDocsError("popup_closed"));
            else reject(new GoogleDocsError("access_denied"));
          },
        })
        .requestAccessToken();
    } catch {
      reject(new GoogleDocsError("script_failed"));
    }
  });
}
