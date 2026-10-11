/**
 * Purpose: the page title band shared by My Profiles, Manage and their detail pages. Same look as the generator's
 * hero (cream band, centred title and subtext) with the InfoBeans heading weight: Lexend Medium, never bold.
 */
export default function PageHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <section className="bg-cream">
      <div className="mx-auto max-w-6xl px-4 py-12 text-center">
        <h1 className="text-3xl font-medium tracking-tight text-ink-dark sm:text-4xl">{title}</h1>
        {subtitle && <p className="mx-auto mt-3 max-w-xl text-sm text-ink-light sm:text-base">{subtitle}</p>}
      </div>
    </section>
  );
}
