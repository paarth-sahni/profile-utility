/**
 * Purpose: POST /api/profiles/[id]/primary — the signed-in user makes one of their own internal profiles their
 * primary profile (the one managers see and use). The database switches it atomically and refuses anyone but the
 * owner; this route only checks the session and maps errors to plain messages.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ProfileNotFoundError, setPrimaryProfile } from "@/lib/db/profiles";
import { allowRequest } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!allowRequest(`primary:${user.id}`, 60, 10 * 60 * 1000)) {
    return err(429, "RATE_LIMITED", "Too many requests. Please wait a moment.");
  }
  const { id } = await params;
  try {
    await setPrimaryProfile(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ProfileNotFoundError) return err(404, "NOT_FOUND", "We could not find that profile.");
    console.error("[profiles] set primary failed");
    return err(500, "SET_PRIMARY_FAILED", "We could not mark this profile as primary. Please try again.");
  }
}
