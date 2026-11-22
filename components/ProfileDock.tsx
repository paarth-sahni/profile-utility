/**
 * Purpose: the actions of a profile page (Download PDF, Open in Google Docs), always within reach however far the document is
 * scrolled, and never over the document. From tablet width (md, 768px) up they are the page's right-hand column, to the RIGHT of the document
 * box: the buttons stacked, held to the bottom of the window while the document is in view and resting at the end of the
 * column (above the footer) at the bottom of the page. On a phone there is no room for a column, so they are a
 * full-width bar at the end of the content that holds to the bottom of the window. The buttons inside
 * pass `dock` so their messages open upwards (a message below a button at the window's edge would be off screen). The
 * confirmation dialogs are native modal dialogs, which always sit above all of this.
 */
import type { ReactNode } from "react";

export default function ProfileDock({ children }: { children: ReactNode }) {
  return (
    // below md the wrapper vanishes (display: contents), so the bar is a direct child of the page and "sticky" can hold it to the
    // window's edge for the page's whole height; from md it is the right-hand grid column, stretched over the document's height
    <div data-profile-dock-column className="contents md:flex md:flex-col md:justify-end">
      <div
        data-profile-dock
        className="sticky bottom-0 z-30 -mx-4 mt-6 flex items-end justify-end gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur sm:bottom-5 sm:mx-0 sm:ml-auto sm:w-fit sm:border sm:shadow-lg md:mx-0 md:ml-0 md:mt-0 md:w-full md:flex-col md:items-stretch md:justify-end md:gap-2 md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none [&_button]:md:w-full [&_button]:md:justify-center [&_button]:md:leading-tight [&>span]:md:w-full [&>span]:md:items-stretch"
      >
        {children}
      </div>
    </div>
  );
}
