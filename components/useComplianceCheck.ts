"use client";

/**
 * Purpose: keeps the client-name marks on the Edit step up to date. While `active`, it asks the server (debounced) whether the
 * current profile names a registered client and exposes the matches; any newer edit cancels the older request, so a slow answer
 * for old text never overwrites a newer one. `checkNow` is the one-off check used right before Preview. When enforcement is off
 * on the server, or the check is unavailable, there is nothing to show.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { checkComplianceRemote, type ComplianceMatch, type ComplianceResult } from "@/lib/complianceClient";
import type { ResumeData, TemplateId } from "@/lib/schemas";

export type LiveCompliance = {
  matches: ComplianceMatch[];
  /** The data the matches were computed for. Marks of text that has changed since are not highlighted. */
  forData: ResumeData | null;
  /** The server could not check (registry unavailable). */
  unavailable: boolean;
};

const NONE: LiveCompliance = { matches: [], forData: null, unavailable: false };
const DEBOUNCE_MS = 500;

export function useComplianceCheck(template: TemplateId, data: ResumeData | null, active: boolean) {
  const [live, setLive] = useState<LiveCompliance>(NONE);
  const seq = useRef(0);

  useEffect(() => {
    if (!active || !data) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void checkComplianceRemote(template, data, controller.signal).then((r) => {
        if (mine !== seq.current) return; // a newer edit started another check
        if (r.status === "ok") setLive({ matches: r.matches, forData: data, unavailable: false });
        else if (r.status === "unavailable") setLive({ matches: [], forData: data, unavailable: true });
        // network errors and an ended session leave the marks as they were
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [template, data, active]);

  /** Marks set from outside (the server refused Preview, PDF or Submit): shown at once, refreshed by the next check. */
  const setFromServer = useCallback((matches: ComplianceMatch[], forData: ResumeData | null) => {
    setLive({ matches, forData, unavailable: false });
  }, []);

  const checkNow = useCallback((d: ResumeData): Promise<ComplianceResult> => checkComplianceRemote(template, d), [template]);

  return { live, setFromServer, checkNow };
}
