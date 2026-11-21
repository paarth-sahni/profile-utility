"use client";

/**
 * Purpose: which cards of an Edit-page item list are open (projects, employers). On first show the first item and every item
 * with a problem are open; an item opens when it gets a problem; the list's own Expand all / Collapse all and the page's
 * (Accordion) both reach it; moves, removals and "add at the top" keep each flag with its item (lib/collapsibleList.ts); after
 * an add at the top, the new first card's first field gets the focus.
 */
import { useEffect, useRef, useState } from "react";
import { fitOpen, initialOpen, insertTopOpen, moveOpen, openNewProblems, removeOpen } from "@/lib/collapsibleList";
import { useAccordionSignal } from "./fields";

export function useCollapsibleList(length: number, needs: boolean[]) {
  const [open, setOpen] = useState(() => initialOpen(length, (i) => needs[i] === true));
  const [seenNeeds, setSeenNeeds] = useState(needs);
  const signal = useAccordionSignal();
  const [seenTick, setSeenTick] = useState(signal.tick);
  const [focusFirst, setFocusFirst] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // adjustments made while rendering (React's pattern for state that follows props)
  if (signal.tick !== seenTick) {
    setSeenTick(signal.tick);
    setOpen(Array.from({ length }, () => signal.mode === "open"));
  }
  if (needs.join() !== seenNeeds.join()) {
    setSeenNeeds(needs);
    setOpen((o) => openNewProblems(fitOpen(o, length), seenNeeds, needs));
  }
  const current = fitOpen(open, length);

  useEffect(() => {
    if (!focusFirst) return;
    setFocusFirst(false);
    listRef.current?.querySelector<HTMLElement>("[data-item-card='0'] input, [data-item-card='0'] textarea")?.focus();
  }, [focusFirst]);

  const update = (f: (o: boolean[]) => boolean[]) => setOpen((o) => f(fitOpen(o, length)));
  return {
    listRef,
    isOpen: (i: number) => current[i] === true,
    toggle: (i: number) => update((o) => o.map((v, j) => (j === i ? !v : v))),
    setAll: (value: boolean) => setOpen(Array.from({ length }, () => value)),
    moved: (from: number, to: number) => update((o) => moveOpen(o, from, to)),
    removed: (i: number) => update((o) => removeOpen(o, i)),
    /** Call with the list update that puts a new item first. */
    addedTop: () => {
      update(insertTopOpen);
      setFocusFirst(true);
    },
  };
}
