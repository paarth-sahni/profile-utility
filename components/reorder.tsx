"use client";

/**
 * Purpose: the drag handle (three lines) that replaces the up / down arrows on every reorderable item of the Edit pages:
 * project and employer cards, skills, bullets, label-and-value fields, custom sections. Drag it with a mouse, a finger or a
 * pen; or focus it and press the arrow keys (Home / End go to the ends) so it works without a pointer too. Nothing
 * moves until you let go: the item follows the pointer, a red line shows where it will land, the page scrolls when the
 * pointer nears its top or bottom edge, and Escape cancels. The list is changed by the caller through `onMove(from, to)`.
 *
 * How it finds the list: the item's root element carries `data-reorder-item`; its siblings carrying it are the list. The
 * decisions (landing index, which neighbour shows the line, keyboard targets) are in lib/reorder.ts, unit-tested.
 */
import type { KeyboardEvent, PointerEvent } from "react";
import { dropIndex, dropMarker, keyboardTarget } from "@/lib/reorder";

const ITEM = "[data-reorder-item]";
const EDGE = 72; // px from the top / bottom of the window where dragging scrolls the page
const STEP = 14; // px scrolled per frame

const itemsAround = (item: HTMLElement): HTMLElement[] =>
  item.parentElement ? ([...item.parentElement.children].filter((el) => el.matches(ITEM)) as HTMLElement[]) : [];

/** After the list re-renders, puts the keyboard focus back on the handle of the item that moved. */
function focusHandleAt(parent: Element | null, index: number) {
  setTimeout(
    () =>
      requestAnimationFrame(() => {
        const items = parent ? [...parent.children].filter((el) => el.matches(ITEM)) : [];
        items[index]?.querySelector<HTMLElement>("[data-drag-handle]")?.focus();
      }),
    0,
  );
}

export default function DragHandle({
  index,
  length,
  onMove,
  label = "item",
  className = "",
}: {
  index: number;
  length: number;
  onMove: (from: number, to: number) => void;
  /** What is being moved, for screen readers: "project 2", "skill 3". */
  label?: string;
  className?: string;
}) {
  const disabled = length < 2;

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    const handle = e.currentTarget;
    const item = handle.closest<HTMLElement>(ITEM);
    if (!item) return;
    const siblings = itemsAround(item);
    const from = siblings.indexOf(item);
    if (from < 0 || siblings.length < 2) return;
    e.preventDefault(); // no text selection, no scrolling by touch while dragging
    handle.focus();
    handle.setPointerCapture(e.pointerId);

    // positions in PAGE coordinates, so the page can scroll while dragging
    const mids = siblings.map((s) => {
      const r = s.getBoundingClientRect();
      return r.top + window.scrollY + r.height / 2;
    });
    const startY = e.clientY + window.scrollY;
    let clientY = e.clientY;
    let to = from;
    let frame = 0;
    item.setAttribute("data-reorder-dragging", "");

    const update = () => {
      const y = clientY + window.scrollY;
      item.style.transform = `translateY(${y - startY}px)`;
      to = dropIndex(mids, from, y);
      siblings.forEach((s) => s.removeAttribute("data-drop"));
      const mark = dropMarker(from, to);
      if (mark) siblings[mark.index].setAttribute("data-drop", mark.side);
    };
    const tick = () => {
      if (clientY < EDGE) window.scrollBy(0, -STEP);
      else if (clientY > window.innerHeight - EDGE) window.scrollBy(0, STEP);
      update();
      frame = requestAnimationFrame(tick);
    };
    const onMovePointer = (ev: globalThis.PointerEvent) => {
      clientY = ev.clientY;
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onEscape = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") finish(false);
    };
    function finish(commit: boolean) {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", onMovePointer);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onEscape);
      item!.removeAttribute("data-reorder-dragging");
      item!.style.transform = "";
      siblings.forEach((s) => s.removeAttribute("data-drop"));
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      if (commit && to !== from) {
        onMove(from, to);
        focusHandleAt(item!.parentElement, to);
      }
    }

    handle.addEventListener("pointermove", onMovePointer);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onEscape);
    frame = requestAnimationFrame(tick);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const to = keyboardTarget(index, length, e.key);
    if (to === null) return;
    e.preventDefault();
    const parent = e.currentTarget.closest<HTMLElement>(ITEM)?.parentElement ?? null;
    onMove(index, to);
    focusHandleAt(parent, to);
  }

  return (
    <button
      type="button"
      data-drag-handle
      disabled={disabled}
      title="Drag to reorder"
      aria-label={`Reorder ${label}: drag it, or press the up and down arrow keys`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`touch-none select-none p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus enabled:cursor-grab enabled:active:cursor-grabbing disabled:opacity-30 disabled:hover:bg-transparent ${className}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </svg>
    </button>
  );
}
