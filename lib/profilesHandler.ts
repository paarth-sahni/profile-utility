/**
 * Purpose: the logic of POST /api/profiles with its collaborators injected, so the whole request (auth, parsing, the
 * client-name gate, consent, save, error answers) can be tested with fakes and no database. app/api/profiles/route.ts wires in
 * the real session, rate limit, registry gate, audit insert and save. Order inside processSave (lib/profileSave.ts).
 */
import { isExternalSave, parseSavePayload, type SavePayload } from "./profilePayload";
import { processSave } from "./profileSave";

export type ProfilesDeps<R> = {
  getUserId: () => Promise<string | null>;
  allow: (userId: string) => boolean;
  gate: (data: unknown) => Promise<Response | null>;
  sanitize: (p: SavePayload) => Promise<SavePayload>;
  recordConsent: (userId: string) => Promise<void>;
  save: (p: SavePayload) => Promise<R>;
  /** Maps a save failure to a response (not found, external, ...); null = unexpected. */
  saveError: (e: unknown) => Response | null;
};

const err = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

export async function handleProfilesPost<R>(request: Request, deps: ProfilesDeps<R>): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!deps.allow(userId)) return err(429, "RATE_LIMITED", "You are saving too quickly. Please wait a moment.");

  let body: unknown;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1_000_000) return err(413, "TOO_LARGE", "That profile is too large to save.");
    body = await request.json();
  } catch {
    return err(400, "BAD_REQUEST", "We could not read that request.");
  }
  if (isExternalSave(body)) return err(400, "EXTERNAL_NOT_SAVED", "External profiles are not saved. Download the PDF instead.");
  const payload = parseSavePayload(body);
  if (!payload) return err(400, "BAD_REQUEST", "That profile could not be saved. Please check it and try again.");

  try {
    // gate -> metadata clean-up -> (Submit) consent record -> save, in that order: a refused request leaves no consent row
    const out = await processSave(payload, {
      gate: deps.gate,
      sanitize: deps.sanitize,
      recordConsent: () => deps.recordConsent(userId),
      save: deps.save,
    });
    return out.kind === "response" ? out.response : Response.json(out.result);
  } catch (e) {
    const mapped = deps.saveError(e);
    if (mapped) return mapped;
    console.error("[profiles] save failed");
    return err(500, "SAVE_FAILED", "We could not save your profile. Please try again.");
  }
}
