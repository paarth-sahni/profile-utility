/**
 * Purpose: the one layout of every page that shows a saved profile (My Profiles, the Profile Hub, the /profile/<IB code> link): no
 * title band, so the document starts at the top of the page. "← Back" sits at the top left; a rail on the left holds the name
 * of the person whose profile it is (with role and details) and stays in view while the document scrolls; the actions
 * (Download PDF, Open in Google Docs) are a column to the right of the document, held to the bottom of the window
 * (components/ProfileDock.tsx). The page uses the full width (a little in from the edges) rather than a narrow centred column,
 * so there is room for all three. On a narrow screen the rail comes above the document and the actions are a bottom bar.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import ProfileDock from "@/components/ProfileDock";

export default function ProfileViewLayout({
  backHref,
  backLabel,
  name,
  role,
  facts = [],
  badges,
  rail,
  actions,
  children,
}: {
  backHref: string;
  backLabel: string;
  /** The person whose profile this is. */
  name: string;
  role?: string;
  /** Short lines under the name: the profile kind, the owner, the IB code. */
  facts?: string[];
  /** Small status items next to each other under the facts (the Primary badge, "Mark as primary"). */
  badges?: ReactNode;
  /** More in the rail below the name card: a button, the version history. */
  rail?: ReactNode;
  /** The dock's buttons; leave out when there is nothing to export. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  // from md the page itself is the grid: the back link and the name card across the top, then the document with the actions to its
  // right; from lg the name card moves to the left of the document (a sticky rail). Below md everything stacks and the actions bar
  // is a direct child of the page, which is what lets it hold to the bottom of the window.
  const columns = actions
    ? "md:grid-cols-[minmax(0,1fr)_11rem] lg:grid-cols-[14rem_minmax(0,1fr)_11rem] xl:grid-cols-[17rem_minmax(0,1fr)_13rem]"
    : "md:grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]";
  return (
    <main className={`mx-auto w-full max-w-[96rem] px-4 pb-8 pt-4 text-ink md:grid md:gap-x-6 md:gap-y-4 md:px-6 ${columns}`} data-profile-view>
      <Link href={backHref} className="inline-flex items-center gap-1 justify-self-start text-sm font-medium text-brand-600 hover:underline md:col-span-full">
        <span aria-hidden>←</span> {backLabel}
      </Link>

      <aside aria-label="Whose profile this is" className="mt-4 md:col-span-full md:mt-0 lg:sticky lg:top-20 lg:col-span-1 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto" data-profile-rail>
        <div className="border border-gray-200 bg-white p-5 shadow-sm">
          <h1 className="break-words text-xl font-medium leading-snug text-ink-dark" data-profile-name>
            {name}
          </h1>
          {role && <p className="mt-1 break-words text-sm text-ink">{role}</p>}
          {facts.map((fact) => (
            <p key={fact} className="mt-1.5 break-words text-xs text-ink-light">
              {fact}
            </p>
          ))}
          {badges && <div className="mt-3 flex flex-wrap items-start gap-2">{badges}</div>}
        </div>
        {rail && <div className="mt-4">{rail}</div>}
      </aside>

      <div className="mt-6 min-w-0 md:mt-0">{children}</div>

      {actions && <ProfileDock>{actions}</ProfileDock>}
    </main>
  );
}
