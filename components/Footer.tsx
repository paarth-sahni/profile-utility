const SOCIALS = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/infobeans/",
    icon: (
      <>
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
        <rect x="2" y="9" width="4" height="12" />
        <circle cx="4" cy="4" r="2" />
      </>
    ),
  },
  {
    label: "X",
    href: "https://twitter.com/infobeans",
    fill: true,
    icon: (
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    ),
  },
  {
    label: "Facebook",
    href: "https://www.facebook.com/infobeans",
    icon: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/infobeans",
    icon: (
      <>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </>
    ),
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/user/INFOBEANS",
    icon: (
      <>
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
        <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" />
      </>
    ),
  },
];

export default function Footer() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 text-xs text-ink-light">
      <div className="flex flex-col items-center gap-5 border-t border-hairline py-6 sm:flex-row sm:justify-between">
        <div className="text-xl font-bold leading-tight text-ink">
          Let&apos;s <span className="text-brand-500">Create WOW</span> together!
        </div>
        <div className="flex flex-col items-center gap-2 sm:items-end">
          <span className="text-xs font-normal text-ink-light">Stay connected</span>
          <div className="flex items-center gap-1.5">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-hairline bg-white text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill={s.fill ? "currentColor" : "none"}
                  stroke={s.fill ? "none" : "currentColor"}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {s.icon}
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-hairline py-4 font-light text-ink-light">
        Copyright &copy; 2026 InfoBeans Technologies Limited.
        <br />
        All rights reserved.
      </div>
    </footer>
  );
}
