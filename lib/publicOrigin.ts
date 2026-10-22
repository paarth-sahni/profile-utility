/**
 * Purpose: the address the browser used (https://profile.example.com), for redirects built in route handlers.
 * Behind a reverse proxy the server only sees its own address (localhost:3000), so request.nextUrl.origin
 * sends people to localhost after sign-in. Order: SITE_URL (if set) > X-Forwarded-Host/Proto > Host > fallback.
 */
export function publicOrigin(headers: Headers, fallbackOrigin: string, siteUrl = process.env.SITE_URL): string {
  const configured = siteUrl?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\/[^/\s]+$/i.test(configured)) return configured;

  const first = (name: string) => headers.get(name)?.split(",")[0]?.trim() || "";
  const host = first("x-forwarded-host") || first("host");
  if (!host || /[/\s@]/.test(host)) return fallbackOrigin;

  const forwardedProto = first("x-forwarded-proto");
  const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : new URL(fallbackOrigin).protocol.slice(0, -1);
  return `${proto}://${host}`;
}
