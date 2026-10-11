/**
 * Purpose: tiny browser-test harness for the optional end-to-end scripts (scripts/e2e-*.mjs).
 * It starts a headless Chrome, drives it over the Chrome DevTools Protocol (no extra npm packages), and signs in
 * as the SEEDED local test users (member@example.test, ... password123) by injecting a session cookie, so no
 * Google sign-in is needed. Local stack only: it refuses to run against a production build or a non-local database.
 *
 * Needs: the local Supabase stack with the seed (`npm run db:start && npm run db:reset`), the app running in
 * development (`npm run dev`), Chrome/Chromium, psql, and Node 20 started with --experimental-websocket
 * (the npm script does this). Settings (all optional): APP_URL, E2E_DB_URL, CHROME_BIN, E2E_CHROME_PORT.
 * Test data is named "E2E ..." and deleted when the run ends.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DB_URL = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CHROME = process.env.CHROME_BIN ?? "google-chrome";
const PORT = Number(process.env.E2E_CHROME_PORT ?? 9333);
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs a SQL statement against the local database (psql) and returns its trimmed output. */
export function sql(statement) {
  return execFileSync("psql", [DB_URL, "-X", "-At", "-c", statement], { encoding: "utf8" }).trim();
}

function die(message) {
  console.error(`\ne2e: ${message}\n`);
  process.exit(2);
}

/** Starts Chrome and returns the helper API. Call `finish()` at the end. */
export async function startHarness(title) {
  if (!SB_URL || !SB_KEY) die("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set (run via `npm run test:e2e`, which loads .env.local).");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(new URL(SB_URL).origin)) die("Refusing to run: the Supabase URL is not local.");
  if (!/(127\.0\.0\.1|localhost)/.test(DB_URL)) die("Refusing to run: the database URL is not local.");
  try {
    const res = await fetch(`${APP}/login`, { redirect: "manual" });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    die(`the app is not reachable at ${APP} (${e.message}). Start it with \`npm run dev\` (development mode: seeded @example.test users only sign in there), or set APP_URL.`);
  }
  try {
    sql("select 1");
  } catch {
    die("cannot reach the local database with psql. Run `npm run db:start` (and `npm run db:reset` for the seed).");
  }

  const profileDir = mkdtempSync(join(tmpdir(), "e2e-chrome-"));
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });
  chrome.on("error", () => die(`could not start Chrome ("${CHROME}"). Set CHROME_BIN to a Chrome/Chromium binary.`));
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
    } catch {
      await sleep(200);
    }
  }
  if (!target) {
    chrome.kill();
    die(`Chrome did not start on port ${PORT} (is another one using it? set E2E_CHROME_PORT).`);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const dialogs = [];
  const listeners = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method) for (const fn of listeners.get(d.method) ?? []) fn(d.params);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
    if (d.method === "Page.javascriptDialogOpening") {
      dialogs.push(d.params.message);
      send("Page.handleJavaScriptDialog", { accept: true }); // native confirm / beforeunload: accept
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const waitFor = async (expr, label, ms = 20000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      try {
        const v = await ev(expr);
        if (v) return v;
      } catch {
        /* page is navigating */
      }
      await sleep(200);
    }
    throw new Error(`timeout waiting for: ${label}`);
  };

  let pass = 0;
  let fail = 0;
  const h = {
    APP,
    dialogs,
    /** Subscribes to a CDP event, e.g. on("Network.requestWillBeSent", (params) => ...). */
    on(method, fn) {
      listeners.set(method, [...(listeners.get(method) ?? []), fn]);
    },
    sleep,
    sql,
    send,
    ev,
    waitFor,
    /** Records one assertion. */
    check(name, ok, extra = "") {
      ok ? pass++ : fail++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${extra}`}`);
    },
    /** Navigates and waits for the page to load. */
    async goto(path) {
      await send("Page.navigate", { url: APP + path });
      await sleep(300);
      await waitFor("document.readyState==='complete'", `load ${path}`);
    },
    /**
     * Clicks the first element whose text contains `text` (focusing it first, like a real click). It waits up to 4 s
     * for React to attach its handlers to that element: right after a page load a click can otherwise land before
     * hydration and do nothing.
     */
    async click(text, selector = "button") {
      const find = `[...document.querySelectorAll('${selector}')].find(b=>b.textContent.trim().includes(${JSON.stringify(text)}))`;
      const t0 = Date.now();
      while (Date.now() - t0 < 4000) {
        if (await ev(`(()=>{const b=${find}; return !!b && Object.keys(b).some(k=>k.startsWith('__reactProps'))})()`)) break;
        await sleep(100);
      }
      return ev(`(()=>{const b=${find}; if(!b) return false; b.focus(); b.click(); return true})()`);
    },
    bodyText: () => ev("document.body.innerText"),
    /** Types into the "Name" field the way a user would (React sees an input event). */
    setName: (v) =>
      ev(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith('Name')); const i=l.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(v)}); i.dispatchEvent(new Event('input',{bubbles:true}));})()`),
    getName: () => ev(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith('Name')); return l?.querySelector('input')?.value ?? null})()`),
    draftOf: (template = "internal") => ev(`sessionStorage.getItem('profile-draft:v1:${template}')`),
    /** Presses a key in the page. */
    async key(key, code, vk) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
    },
    /** Signs in as a seeded user (member, member2, checker, manager, admin) by setting the session cookie. */
    async signIn(who) {
      sql(`update auth.users set last_sign_in_at = now() where email='${who}@example.test'`);
      const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
      const { data, error } = await sb.auth.signInWithPassword({ email: `${who}@example.test`, password: "password123" });
      if (error) throw new Error(`sign-in as ${who} failed: ${error.message}. Did you run npm run db:reset?`);
      const name = `sb-${new URL(SB_URL).hostname.split(".")[0]}-auth-token`;
      const value = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
      const parts = value.match(/.{1,3180}/g);
      await send("Network.clearBrowserCookies");
      const cookies = parts.length === 1 ? [{ name, value }] : parts.map((v, i) => ({ name: `${name}.${i}`, value: v }));
      for (const c of cookies) await send("Network.setCookie", { ...c, url: APP });
    },
    /** Pretends the sign-in is `interval` old (e.g. "1 hour 56 minutes") by editing last_sign_in_at. */
    ageSession: (who, interval) => sql(`update auth.users set last_sign_in_at = now() - interval '${interval}' where email='${who}@example.test'`),
    /** Runs one scenario; an exception counts as a failure and does not stop the others. */
    async scenario(name, fn) {
      console.log(`\n# ${name}`);
      try {
        await fn();
      } catch (e) {
        fail++;
        console.log(`FAIL  ${name}: ${e.message}`);
      }
    },
    /** Deletes the "E2E ..." test data, closes Chrome (and its temp profile), prints the summary and exits. */
    async finish() {
      try {
        sql(`delete from profiles where candidate_name like 'E2E %'`);
        sql(`update auth.users set last_sign_in_at = now() where email like '%@example.test'`);
      } catch {
        /* best effort */
      }
      try {
        ws.close();
        const exited = new Promise((r) => chrome.once("exit", r));
        chrome.kill();
        await Promise.race([exited, sleep(3000)]); // Chrome writes to its profile until it exits
        rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      console.log(`\n${title}: ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    },
  };
  return h;
}
