/**
 * Purpose: the page title band shared by My Profiles, Manage and their detail pages. Same look as the generator's
 * hero (cream band, centred title and subtext) with the InfoBeans heading weight: Lexend Medium, never bold.
 * `action` (e.g. a button) sits level with the title at the right on wider screens and under it on phones;
 * `compact` trims the vertical space for pages that want their content close to the heading and draws a thin line
 * under the band to separate it from the content; its subtitle stays on one line on wider screens.
 */
import type { ReactNode } from "react";

export default function PageHero({
  title,
  subtitle,
  action,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`bg-cream ${compact ? "border-b border-hairline" : ""}`}>
      <div className={`relative mx-auto max-w-6xl px-4 text-center ${compact ? "py-6" : "py-12"}`}>
        <h1 className="text-3xl font-medium tracking-tight text-ink-dark sm:text-4xl">{title}</h1>
        {subtitle && (
          <p className={`mx-auto mt-3 text-sm text-ink-light sm:text-base ${compact ? "max-w-none sm:whitespace-nowrap" : "max-w-xl"}`}>{subtitle}</p>
        )}
        {action && <div className="mt-4 flex justify-center sm:absolute sm:right-4 sm:top-1/2 sm:mt-0 sm:-translate-y-1/2">{action}</div>}
      </div>
    </section>
  );
}
