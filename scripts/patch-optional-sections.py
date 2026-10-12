#!/usr/bin/env python3
"""
Purpose: one-off, reproducible edit of the Word templates so every OPTIONAL section disappears (heading, content and
its spacer paragraph) when it has nothing real in it. Reads the untouched originals from
docs/template-backups/*.before-optional-sections.docx and writes public/templates/{internal,external}.docx.

How: docxtemplater loop tags ({#flag} ... {/flag}) are inserted as their own paragraphs around a block of paragraphs
(the same way hasProjects / hasTeamSize already work); with paragraphLoop on, the tag paragraphs vanish and so does the
whole block when the flag is false. The flags are set in lib/docxData.ts (prepareData). Two heading lines get an inline
condition so no dangling " - " is left. Paragraph numbers below are positions in the ORIGINAL document.xml (the two
printed listings in the commit message of the templates commit show them). Run: python3 scripts/patch-optional-sections.py
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKUPS = ROOT / "docs" / "template-backups"
OUT = ROOT / "public" / "templates"

# template -> list of (first paragraph, last paragraph, flag): wrap paragraphs first..last (inclusive) in {#flag}..{/flag}
WRAPS = {
    "internal": [
        (3, 3, "hasExperienceSummary"),  # header line under the job title
        (4, 4, "hasSpecialization"),  # header line
        (18, 20, "hasTech"),  # project: spacer + "Tools & Technologies" heading + value
        (26, 28, "hasRole"),  # project: spacer + "Role" heading + value
        (34, 34, "hasDescription"),  # project: description paragraph
        (46, 50, "hasCertifications"),  # sidebar: heading + items + spacer
        (51, 53, "hasTools"),  # sidebar: heading + value + spacer
        (60, 64, "hasDomains"),  # sidebar: heading + items + spacer
        (65, 68, "hasLanguages"),  # sidebar: heading + items
        # Projects heading (12-14: hasProjects) and Managerial Experience (54-59: hasManagerialExperience) already exist.
    ],
    "external": [
        (3, 3, "hasExperienceSummary"),
        (4, 4, "hasSpecialization"),
        (19, 21, "hasTools"),  # heading + value + spacer
        (22, 24, "hasCertifications"),  # heading + value + spacer
        (25, 25, "hasProjects"),  # the shared "Projects/Experience" heading: only when there ARE projects (with employers only, the "Experience" heading below stands alone)
        (34, 36, "hasRole"),  # project: spacer + "Role" heading + value
        (37, 38, "hasDescription"),  # project: spacer + description
        (39, 42, "hasResponsibilities"),  # project: spacer + bullets
        (46, 56, "hasExperience"),  # spacer + "Experience" heading + the whole employer loop
        (50, 50, "hasPosition"),  # employer: position line
        (51, 51, "hasDuration"),  # employer: duration line
        (52, 55, "hasHighlights"),  # employer: spacer + bullets
    ],
}

# Inline conditions inside one heading run: nothing is left dangling when the value is empty.
INLINE = {
    "internal": [("Project {number} - {duration}", "Project {number}{#hasDuration} - {duration}{/hasDuration}")],
    "external": [("Project {number} - {duration}", "Project {number}{#hasDuration} - {duration}{/hasDuration}")],
}

PARA = re.compile(r"<w:p[ >].*?</w:p>", re.S)


def marker(tag: str) -> str:
    return f'<w:p><w:r><w:t xml:space="preserve">{tag}</w:t></w:r></w:p>'


def patch(name: str) -> bytes:
    src = BACKUPS / f"{name}.before-optional-sections.docx"
    with zipfile.ZipFile(src) as zin:
        xml = zin.read("word/document.xml").decode("utf8")
        before: dict[int, list[str]] = {}
        after: dict[int, list[str]] = {}
        for first, last, flag in WRAPS[name]:
            # outer wraps open first / close last: lists keep insertion order, so sort wraps by size below
            before.setdefault(first, []).append((last - first, marker("{#" + flag + "}")))
            after.setdefault(last, []).append((last - first, marker("{/" + flag + "}")))
        count = 0

        def rebuild(match: re.Match) -> str:
            nonlocal count
            i = count
            count += 1
            text = match.group(0)
            for old, new in INLINE[name]:
                if old in text:
                    text = text.replace(old, new)
            opens = "".join(m for _, m in sorted(before.get(i, []), key=lambda t: -t[0]))  # outermost first
            closes = "".join(m for _, m in sorted(after.get(i, []), key=lambda t: t[0]))  # innermost first
            return opens + text + closes

        new_xml = PARA.sub(rebuild, xml)
        out = OUT / f"{name}.docx"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = new_xml.encode("utf8") if item.filename == "word/document.xml" else zin.read(item.filename)
                zout.writestr(item, data)
    return out.read_bytes()


if __name__ == "__main__":
    for template in ("internal", "external"):
        data = patch(template)
        print(f"{template}: wrote public/templates/{template}.docx ({len(data)} bytes)")
    sys.exit(0)
