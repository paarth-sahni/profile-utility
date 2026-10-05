import type { Metadata } from "next";
import { Lexend } from "next/font/google";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import Footer from "@/components/Footer";

const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Profile Generator — InfoBeans",
  description: "Generate branded InfoBeans profile documents (DOCX & PDF) from LLM-extracted JSON. Creating WOW!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${lexend.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-[--background] text-ink">
        <SiteNav />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
