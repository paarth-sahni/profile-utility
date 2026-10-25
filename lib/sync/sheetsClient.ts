/**
 * Purpose: read-only access to the Google Sheet. Two calls only: the tab titles, and columns A:E of the chosen tabs in
 * as few requests as possible (a whole synchronisation is about 3 requests). Nothing else is ever requested, so no other
 * column can be stored or logged. Failures become SyncError codes; Google's response text, the spreadsheet id and cell
 * values are never put in an error. `fetch` and the token source are injected so tests use no network.
 */
import { SyncError } from "./errors";
import { sheetsHint } from "./hints";
import { codeForStatus, getAccessToken, type FetchFn } from "./googleAuth";
import type { SheetsConfig } from "./config";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TABS_PER_REQUEST = 20;

/** Rows of columns A:E as Google returns them (cells may be strings, numbers, or missing). */
export type TabRows = unknown[][];

/** A tab that was read, or one that could not be read this time (a temporary problem, so the run is partial). */
export type TabRead = { rows: TabRows } | { failed: SyncError };

export type SheetsClient = {
  /** Titles of all tabs, in sheet order. */
  listTabs: () => Promise<string[]>;
  /** Columns A:E per requested title. */
  readTabs: (titles: readonly string[]) => Promise<Map<string, TabRead>>;
};

/** `'Sheet1'!A:E`, with a quote in the title doubled as Sheets requires. */
export const rangeFor = (title: string): string => `'${title.replace(/'/g, "''")}'!A:E`;

type Deps = { fetchFn?: FetchFn; getToken?: () => Promise<string> };

export function createSheetsClient(config: SheetsConfig, deps: Deps = {}): SheetsClient {
  const fetchFn: FetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
  let token: Promise<string> | null = null;
  const getToken = (): Promise<string> => {
    token ??= (deps.getToken ?? (() => getAccessToken(config, fetchFn)))();
    // a failed token request must not be cached forever
    token.catch(() => (token = null));
    return token;
  };

  async function getJson(url: string): Promise<unknown> {
    const bearer = await getToken();
    let res: Response;
    try {
      res = await fetchFn(url, { headers: { authorization: `Bearer ${bearer}` } });
    } catch {
      throw new SyncError("SHEETS_UNAVAILABLE");
    }
    if (!res.ok) {
      // Google's text is read only to choose one of our fixed codes/hints, then dropped (it can name the sheet).
      // Google also answers 403 for "slow down", so look for that first.
      const text = await res.text().catch(() => "");
      if (res.status === 403 && /rateLimitExceeded|RATE_LIMIT_EXCEEDED/i.test(text)) throw new SyncError("SHEETS_RATE_LIMIT");
      const code = codeForStatus(res.status);
      throw code === "SHEETS_AUTH" ? new SyncError(code, sheetsHint(res.status, text)) : new SyncError(code);
    }
    try {
      return await res.json();
    } catch {
      throw new SyncError("SHEETS_UNAVAILABLE");
    }
  }

  async function listTabs(): Promise<string[]> {
    const body = (await getJson(`${BASE}/${encodeURIComponent(config.spreadsheetId)}?fields=sheets.properties.title`)) as {
      sheets?: { properties?: { title?: unknown } }[];
    };
    const titles = (body.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => typeof t === "string");
    if (!Array.isArray(body.sheets)) throw new SyncError("SHEETS_UNAVAILABLE");
    return titles;
  }

  async function readTabs(titles: readonly string[]): Promise<Map<string, TabRead>> {
    const out = new Map<string, TabRead>();
    for (let i = 0; i < titles.length; i += TABS_PER_REQUEST) {
      const chunk = titles.slice(i, i + TABS_PER_REQUEST);
      const query = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" });
      for (const t of chunk) query.append("ranges", rangeFor(t));
      try {
        const body = (await getJson(`${BASE}/${encodeURIComponent(config.spreadsheetId)}/values:batchGet?${query}`)) as {
          valueRanges?: { values?: unknown }[];
        };
        if (!Array.isArray(body.valueRanges) || body.valueRanges.length !== chunk.length) throw new SyncError("SHEETS_UNAVAILABLE");
        chunk.forEach((title, k) => {
          const values = body.valueRanges![k].values;
          out.set(title, { rows: Array.isArray(values) ? (values as unknown[][]) : [] });
        });
      } catch (e) {
        // credentials or sheet problems stop the run; a temporary problem only costs these tabs (the run becomes partial)
        if (e instanceof SyncError && e.retryable) for (const t of chunk) out.set(t, { failed: e });
        else throw e;
      }
    }
    return out;
  }

  return { listTabs, readTabs };
}
