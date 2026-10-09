/**
 * Purpose: browser Supabase client. Used ONLY for authentication (sign-in / sign-out); the browser
 * never queries tables. Uses the publishable key.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
