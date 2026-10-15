"use client";

/**
 * Purpose: makes the browser Back button work inside the single-page generator. The generator moves between
 * steps (Start -> Upload -> Review -> Submit) without changing the URL, so Back used to leave the whole app.
 * Here every step after Start shares ONE history entry on top of the Start entry:
 *   [Start] [any later step]
 * Back from a later step therefore lands on Start. If there is unsaved work, Back is held (the entry is put
 * back) and `pendingBack` turns true so the caller can show its own "Leave without saving?" dialog; then
 * `leave()` finishes the Back and `stay()` forgets it.
 * Only active when the page started at Start (`enabled`); a version opened from My Profiles has no Start
 * entry, so Back there simply returns to where the user came from.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  /** False when the page did not start at the Start step (opened from My Profiles). */
  enabled: boolean;
  /** The current step; 0 is Start. */
  step: number;
  /** True when going back would lose work, so the user must confirm first. */
  askBeforeLeaving: boolean;
  /** Show the Start step (state only; must not touch history). */
  goStart: () => void;
}

const MARK = "pgStep";

const marked = () => (window.history.state as Record<string, unknown> | null)?.[MARK] !== undefined;

export function useStepHistory({ enabled, step, askBeforeLeaving, goStart }: Options) {
  const [pendingBack, setPendingBack] = useState(false);

  // latest values for the popstate listener, which is installed once
  const live = useRef({ step, askBeforeLeaving, goStart });
  live.current = { step, askBeforeLeaving, goStart };
  const skipGuard = useRef(false); // next Back was confirmed: do not ask again
  const ignoreNext = useRef(false); // next popstate came from our own history.back()
  const firstRun = useRef(true);

  // keep the history entry in step with the screen
  useEffect(() => {
    if (!enabled) return;
    if (firstRun.current) {
      firstRun.current = false;
      // After a reload (or coming back to this entry) the browser still carries our marker while the page starts
      // fresh at Start. Just clear the marker; going "back" here would throw the user out to the previous page.
      if (step === 0 && marked()) {
        const { [MARK]: _stale, ...rest } = (window.history.state ?? {}) as Record<string, unknown>;
        void _stale;
        window.history.replaceState(rest, "", window.location.href);
      }
    }
    if (step > 0) {
      // Start -> later step: add the entry. Later step -> later step: reuse it.
      if (marked()) window.history.replaceState({ [MARK]: step }, "", window.location.href);
      else window.history.pushState({ [MARK]: step }, "", window.location.href);
    } else if (marked()) {
      // The UI went back to Start by itself (stepper, in-page Back): drop the extra entry too.
      ignoreNext.current = true;
      window.history.back();
    }
  }, [enabled, step]);

  useEffect(() => {
    if (!enabled) return;
    const onPop = (e: PopStateEvent) => {
      if (ignoreNext.current) {
        ignoreNext.current = false;
        return;
      }
      const toStep = (e.state as Record<string, unknown> | null)?.[MARK];
      if (toStep !== undefined) return; // Forward onto a step entry: leave the screen as it is
      const cur = live.current;
      if (cur.step === 0) return;
      if (skipGuard.current) {
        skipGuard.current = false;
        cur.goStart();
        return;
      }
      if (cur.askBeforeLeaving) {
        // Hold the Back: put the step entry back so the page and history agree, then ask.
        window.history.pushState({ [MARK]: cur.step }, "", window.location.href);
        setPendingBack(true);
        return;
      }
      cur.goStart();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled]);

  const stay = useCallback(() => setPendingBack(false), []);
  const leave = useCallback(() => {
    setPendingBack(false);
    skipGuard.current = true;
    window.history.back();
  }, []);

  return { pendingBack, stay, leave };
}
