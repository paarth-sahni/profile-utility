/**
 * Purpose: one-time DEVELOPER sign-in so the local registry sync can read your test Google Sheet as YOU (no service account,
 * no sharing). Opens Google's consent page for READ-ONLY access to spreadsheets, receives the answer on 127.0.0.1, and stores the
 * resulting refresh token in .env.local (git-ignored). It prints no token or secret. Refused in production and whenever the
 * database URL is not local. Remove the token afterwards: https://myaccount.google.com/permissions
 * Run: npm run sync:login   (reads GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET from .env.local)
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isLoopbackUrl } from "../lib/sync/config";
import { SyncError } from "../lib/sync/errors";
import { buildAuthUrl, exchangeCodeForRefreshToken, pkcePair, upsertEnvLine } from "../lib/sync/userLogin";

const ENV_FILE = ".env.local";
const TIMEOUT_MS = 5 * 60 * 1000;
// A fixed port, so a "Web application" OAuth client can list the one redirect address http://127.0.0.1:<port> (a "Desktop app" client accepts any).
const PORT = Number(process.env.SYNC_LOGIN_PORT) || 53682;

function openInBrowser(url: string): void {
  // arguments are passed without a shell, so the "&" in the address needs no quoting
  const [cmd, args]: [string, string[]] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    /* the address is printed too */
  }
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === "production") throw new SyncError("CONFIG", "sync:login is a development tool and is refused in production.");
  const db = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (db && !isLoopbackUrl(db)) throw new SyncError("CONFIG", "sync:login only runs with the local database (NEXT_PUBLIC_SUPABASE_URL is not a local address). Use .env.local, not .env.");
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId) throw new SyncError("CONFIG", "GOOGLE_OAUTH_CLIENT_ID is not set in .env.local.");
  if (!clientSecret) throw new SyncError("CONFIG", "GOOGLE_OAUTH_CLIENT_SECRET is not set in .env.local.");

  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString("base64url");

  const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const ok = url.searchParams.get("state") === state && !!url.searchParams.get("code");
      res.writeHead(ok ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
      res.end(ok ? "Signed in. You can close this tab and go back to the terminal." : "Sign-in was cancelled or did not match. Go back to the terminal and run it again.");
      server.close();
      if (ok) resolve({ code: url.searchParams.get("code")!, redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo | null)?.port ?? port}` });
      else reject(new SyncError("SHEETS_AUTH", "The sign-in was cancelled or did not match."));
    });
    let port = 0;
    const timer = setTimeout(() => {
      server.close();
      reject(new SyncError("SHEETS_AUTH", "No sign-in within 5 minutes."));
    }, TIMEOUT_MS);
    server.on("close", () => clearTimeout(timer));
    server.on("error", () => {
      clearTimeout(timer);
      reject(new SyncError("CONFIG", `Port ${PORT} is busy. Close whatever uses it, or set SYNC_LOGIN_PORT in .env.local (and add that redirect address to the OAuth client).`));
    });
    server.listen(PORT, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      const url = buildAuthUrl({ clientId, redirectUri: `http://127.0.0.1:${port}`, state, challenge });
      console.log(`Redirect address used: http://127.0.0.1:${port} (a "Web application" OAuth client must list exactly this under Authorized redirect URIs)\n`);
      console.log("Opening Google's sign-in page (read-only access to spreadsheets). If nothing opens, copy this address into your browser:\n");
      console.log(url + "\n");
      openInBrowser(url);
    });
  });

  const refreshToken = await exchangeCodeForRefreshToken({ clientId, clientSecret, code: code.code, verifier, redirectUri: code.redirectUri }, (u, i) => fetch(u, i));
  const before = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  writeFileSync(ENV_FILE, upsertEnvLine(before, "GOOGLE_OAUTH_REFRESH_TOKEN", refreshToken));
  console.log(`Done. The sign-in is saved in ${ENV_FILE} (not shown here). Next: npm run sync:inspect:local`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof SyncError ? `${e.code}: ${e.message}` : "sync:login failed.");
    process.exit(1);
  },
);
