# Resume Generator

Frontend-only Next.js app that generates a styled resume `.docx` from one of two
Word templates, using JSON produced by an external LLM. No backend — everything
(validation, editing, rendering, download) happens in the browser.

## How it works

1. **Template selection** — pick *External Profile* or *Internal Profile*, then
   **Copy LLM Prompt**. Paste that prompt into any LLM together with a resume
   file; it replies with JSON matching the template's schema.
2. **Paste JSON** — the JSON is validated with Zod; field-level errors are shown.
3. **Review & edit** — all fields are editable (array items can be added,
   removed and reordered). **Preview** shows the exact PDF in an iframe.
   Download as **DOCX** (docxtemplater + pizzip, original Word template),
   **PDF** (built natively in the browser with pdf-lib using the template's
   Lexend fonts + logo from `public/fonts` / `public/img`), or both.

Additional pages: **/instructions** (step-by-step generation process for each
template) and **/style-guide** (the typography Style Guide PDF, embedded as-is
from `public/style-guide/`).

## Templates

The originals (`IB - External Profile Format.docx`, `IB - Internal Profile
Format Final.docx`, in the parent folder) were converted into docxtemplater
templates by inserting `{placeholder}` and `{#loop}…{/loop}` tags directly into
their `word/document.xml`, preserving every font, color, size, spacing and the
embedded logo. The tagged copies live in `public/templates/`.

To re-tag after changing a source template, adjust the paraId-keyed rules and run:

```bash
python3 ../tag_templates.py
```

`node test-render.mjs` renders both tagged templates with sample data and
checks for leftover tags (writes outputs to `/tmp/out-*.docx`).

## Key files

- `lib/schemas.ts` — Zod schemas for both templates (source of truth for the JSON shape)
- `lib/prompts.ts` — the LLM extraction prompts (schema + rules + example)
- `lib/generate.ts` — docxtemplater rendering, data mapping, error explanation
- `lib/pdf.ts` — native PDF layout engine + both template renderers (pure, node-testable)
- `lib/pdfClient.ts` — browser asset loading, PDF blob/download helpers
- `components/ExternalForm.tsx`, `components/InternalForm.tsx` — step-3 editors
- `components/DocPreview.tsx` — PDF preview pane with refresh/stale indicator

`npx tsx test-pdf.mts` builds sample PDFs for both templates to `/tmp` for
visual inspection.

## Develop

```bash
npm install
npm run dev
```
