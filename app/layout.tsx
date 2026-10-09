import type { Metadata } from "next";
import { Lexend } from "next/font/google";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import Footer from "@/components/Footer";
import { sessionExpired } from "@/lib/authRules";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NavUser } from "@/components/UserMenu";

const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Profile Generator — InfoBeans",
  description: "Generate branded InfoBeans profile documents (DOCX) from an uploaded resume. Creating WOW!",
};

/** The signed-in user's display details (name and photo come from the Google profile). */
async function currentUser(): Promise<NavUser | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u?.email || sessionExpired(u.last_sign_in_at)) return null;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const name = str(meta.full_name) ?? str(meta.name) ?? u.email.split("@")[0];
    return { name, email: u.email, avatarUrl: str(meta.avatar_url) ?? str(meta.picture) };
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${lexend.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-[--background] text-ink">
        <SiteNav user={user} />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
