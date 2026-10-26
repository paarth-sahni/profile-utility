/**
 * Purpose: browser side of consent recording — calls POST /api/consent before a profile is submitted, downloaded or
 * opened in Google Docs. Throws ConsentError (with the HTTP status, so the caller can treat 401 as "session ended")
 * when the confirmation could not be recorded; the action must not go ahead in that case.
 */
import type { ConsentAction } from "./consent";
import type { TemplateId } from "./schemas";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export class ConsentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConsentError";
  }
}

/** Records that the user confirmed the profile before `action`. Resolves when the audit row is written. */
export async function recordConsent(template: TemplateId, action: ConsentAction): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, action, accepted: true }),
    });
  } catch {
    throw new ConsentError("We could not reach the server to record your confirmation. Please check your connection and try again.", 0);
  }
  if (res.ok) return;
  let message = "We could not record your confirmation. Please try again.";
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    if (json.error?.message) message = json.error.message;
  } catch {
    /* keep the generic message */
  }
  throw new ConsentError(message, res.status);
}
