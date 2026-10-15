/**
 * Purpose: the Profile Generator icon: a document with a person on it (the profile) and a small spark
 * (generated for you). Pure SVG in the brand red and charcoal, so it stays sharp at any size.
 */
export default function ProfileGeneratorMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 44" className={className} fill="none" role="img" aria-label="Profile Generator">
      {/* document with a folded corner */}
      <path
        d="M9 4h15l9 9v25a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"
        fill="#fff"
        stroke="var(--color-ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M24 4v7a2 2 0 0 0 2 2h7" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" />
      {/* the person: head and shoulders */}
      <circle cx="19.5" cy="21" r="4.5" fill="var(--color-brand-500)" />
      <path d="M11 35c.7-4.9 4.3-7.4 8.5-7.4s7.8 2.5 8.5 7.4Z" fill="var(--color-brand-500)" />
      {/* the spark: generated for you */}
      <path d="M37 2l1.5 4.2L42.7 7.7l-4.2 1.5L37 13.4l-1.5-4.2-4.2-1.5 4.2-1.5L37 2Z" fill="var(--color-brand-500)" />
    </svg>
  );
}
