/**
 * Purpose: POST /api/profiles — saves a new version of the signed-in user's profile.
 * Ownership comes from the session, never from the request body. Errors are generic and nothing about
 * the profile content is logged.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveVersion } from "@/lib/db/profiles";
import { parseSavePayload } from "@/lib/profilePayload";
import { allowRequest } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!allowRequest(`save:${user.id}`, 60, 10 * 60 * 1000)) {
    return err(429, "RATE_LIMITED", "You are saving too quickly. Please wait a moment.");
  }

  let body: unknown;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1_000_000) return err(413, "TOO_LARGE", "That profile is too large to save.");
    body = await request.json();
  } catch {
    return err(400, "BAD_REQUEST", "We could not read that request.");
  }
  const payload = parseSavePayload(body);
  if (!payload) return err(400, "BAD_REQUEST", "That profile could not be saved. Please check it and try again.");

  try {
    return NextResponse.json(await saveVersion(payload));
  } catch {
    console.error("[profiles] save failed");
    return err(500, "SAVE_FAILED", "We could not save your profile. Please try again.");
  }
}
