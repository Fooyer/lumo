import type { ReactNode } from 'react'

/**
 * A titled group of settings. The search box filters by `.settings-item` blocks inside `.settings-section`
 * elements (see SettingsPage), so every control goes in an Item together with the hint that explains it.
 */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="settings-section" data-title={title}>
      <h2>{title}</h2>
      {hint && <p className="settings-hint settings-section__hint">{hint}</p>}
      {children}
    </section>
  )
}

/** One searchable setting: `keywords` are extra words that should find it (synonyms, related terms). */
export function Item({ keywords, children }: { keywords?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="settings-item" data-keywords={keywords}>
      {children}
    </div>
  )
}
