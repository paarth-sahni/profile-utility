#!/usr/bin/env python3
"""
Purpose: reproducible edit of the Word templates. Reads the untouched originals from
docs/template-backups/*.before-optional-sections.docx and writes public/templates/{internal,external}.docx. Never edit the
template XML by hand: change this script and run it again. Run: python3 scripts/patch-templates.py

1. Optional sections: every OPTIONAL section disappears (heading, content and its spacer paragraph) when it has nothing
   real in it. docxtemplater loop tags ({#flag} ... {/flag}) are inserted as their own paragraphs around a block of
   paragraphs (the same way hasProjects / hasTeamSize already work); with paragraphLoop on, the tag paragraphs vanish and
   so does the whole block when the flag is false. The flags are set in lib/docxData.ts (prepareData). Two heading lines
   get an inline condition so no dangling " - " is left.
2. Formatting (LOGO below):
   - the InfoBeans logo keeps its aspect ratio (cropped exactly to the artwork, box = the artwork's ratio) and sits
     directly below "A PROUD MEMBER OF", left edges aligned;
Paragraph numbers below are positions in the ORIGINAL document.xml (python3 -c "..." listing in the commit messages).
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKUPS = ROOT / "docs" / "template-backups"
OUT = ROOT / "public" / "templates"

# ------------------------------------------------------------------------------------------------ 1. optional sections
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

# Extra blank paragraphs AFTER a paragraph: (paragraph, xml). The internal sidebar's Managerial Experience block had no
# spacer (its items ran straight into the next heading); this one sits inside the existing {#hasManagerialExperience}
# (paragraphs 54-59), after the last item (58 = {/managerialExperience}), so it goes with the section.
# Same form as the Certifications spacer (plain, no list numbering), without its rsid / paraId attributes.
SPACER = '<w:p><w:pPr><w:jc w:val="left"/><w:rPr><w:color w:val="231f20"/></w:rPr></w:pPr><w:r><w:rPr><w:rtl w:val="0"/></w:rPr></w:r></w:p>'
SPACERS = {"internal": [(58, SPACER)], "external": []}

# ---------------------------------------------------------------------------------------------------- 2. formatting
# The logo artwork inside the 1000x500 PNG (the rest is transparent): left, top, right, bottom in pixels.
ART = (153, 141, 847, 359)
ART_SIZE = (1000, 500)
EMU_PER_PT = 12700
LOGO_WIDTH_PT = 104  # the artwork's width on the page (as before)
LOGO_GAP_PT = 2  # from the bottom of the "A PROUD MEMBER OF" line to the top of the logo
# Left edge of the label and the logo, from the left page margin. Internal: the sidebar's text column (where "Skills"
# starts). External (one column): logo flush with the right margin (text width 468pt).
LOGO_LEFT_PT = {"internal": 377.7, "external": 468 - LOGO_WIDTH_PT}
# The label's glyphs reach 0.7pt below the bottom of its line (measured on the LibreOffice PDF).
LABEL_DESCENT_PT = 0.7

PARA = re.compile(r"<w:p[ >].*?</w:p>", re.S)
PPR_ORDER = [
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers",
    "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE",
    "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents",
    "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle",
    "rPr", "sectPr", "pPrChange",
]
PPR_CHILD = re.compile(r"<w:(rPr|numPr|tabs|pBdr|sectPr|pPrChange|framePr)\b[^>]*?(?:/>|>.*?</w:\1>)|<w:(\w+)\b[^>]*/>", re.S)


def marker(tag: str) -> str:
    return f'<w:p><w:r><w:t xml:space="preserve">{tag}</w:t></w:r></w:p>'


def attrs(values: dict) -> str:
    return " ".join(f'w:{k}="{v}"' for k, v in values.items())


def set_ppr(para: str, changes: dict) -> str:
    """Sets / replaces ind and jc in the paragraph's properties, keeping the schema order."""
    m = re.search(r"<w:pPr>(.*?)</w:pPr>|<w:pPr/>", para, re.S)
    inner = m.group(1) or "" if m else ""
    children = {}
    for c in PPR_CHILD.finditer(inner):
        children[c.group(1) or c.group(2)] = c.group(0)
    if "ind" in changes:
        children["ind"] = f"<w:ind {attrs(changes['ind'])}/>"
    if "jc" in changes:
        children["jc"] = f'<w:jc w:val="{changes["jc"]}"/>'
    ppr = "<w:pPr>" + "".join(children[k] for k in sorted(children, key=lambda k: PPR_ORDER.index(k) if k in PPR_ORDER else 99)) + "</w:pPr>"
    if m:
        return para[: m.start()] + ppr + para[m.end() :]
    head = re.match(r"<w:p[^>]*>", para).group(0)
    return head + ppr + para[len(head) :]


def label(para: str, name: str) -> str:
    """'A PROUD MEMBER OF': no tabs or padding spaces, starts exactly where the logo starts."""
    para = para.replace("<w:tab/>", "")
    para = re.sub(r"(<w:t[^>]*>)([^<]*)(</w:t>)", lambda t: t.group(1) + t.group(2).strip() + t.group(3), para)
    twips = round(LOGO_LEFT_PT[name] * 20)
    return set_ppr(para, {"ind": {"left": str(twips), "right": "0", "firstLine": "0"}, "jc": "left"})


def cell_left_pt(xml: str) -> float:
    """Where text starts in the first table cell, from the page margin (0 without a table)."""
    table = re.search(r"<w:tbl>.*?<w:tc>.*?</w:tcPr>", xml, re.S)
    if not table:
        return 0.0
    ind = re.search(r'<w:tblInd w:w="([\d.]+)" w:type="dxa"/>', table.group(0))
    mar = re.search(r'<w:tcMar>.*?<w:left w:w="([\d.]+)" w:type="dxa"/>', table.group(0), re.S)
    return (float(ind.group(1)) if ind else 0) / 20 + (float(mar.group(1)) if mar else 0) / 20


def cell_top_pt(xml: str) -> float:
    """The first table cell's top margin (0 without a table): its first paragraph starts that far below the row."""
    table = re.search(r"<w:tbl>.*?<w:tc>.*?</w:tcPr>", xml, re.S)
    mar = table and re.search(r'<w:tcMar>.*?<w:top w:w="([\d.]+)" w:type="dxa"/>', table.group(0), re.S)
    return float(mar.group(1)) / 20 if mar else 0.0


def logo(para: str, name: str, xml: str) -> str:
    """The anchored logo: cropped to the artwork, true aspect ratio, directly below the label, left edges aligned."""
    l, t, r, b = ART
    w, h = ART_SIZE
    cx = LOGO_WIDTH_PT * EMU_PER_PT
    cy = round(cx * (b - t) / (r - l))
    crop = f'<a:srcRect l="{round(l / w * 100000)}" t="{round(t / h * 100000)}" r="{round((w - r) / w * 100000)}" b="{round((h - b) / h * 100000)}"/>'
    # horizontal: from the text column the anchor is in. In the internal template that is the table cell holding the
    # name (Word and LibreOffice agree on that), whose text starts tblInd + the cell's left margin from the page margin.
    x = round((LOGO_LEFT_PT[name] - cell_left_pt(xml)) * EMU_PER_PT)
    # vertical: from the paragraph the logo is anchored in (the name), which starts right below the label's line, plus
    # the cell's top margin in the internal template
    y = round((LOGO_GAP_PT + LABEL_DESCENT_PT - cell_top_pt(xml)) * EMU_PER_PT)
    drawing = re.search(r"<w:drawing>.*?</w:drawing>", para, re.S).group(0)
    # no wrap distance above the logo: it sits right under the label, which must not be pushed down by it
    new = re.sub(r'(<wp:(?:anchor|wrapSquare)\b[^>]*?)distT="\d+"', r'\1distT="0"', drawing)
    new = re.sub(r"<wp:positionH .*?</wp:positionH>", f'<wp:positionH relativeFrom="column"><wp:posOffset>{x}</wp:posOffset></wp:positionH>', new, flags=re.S)
    new = re.sub(r"<wp:positionV .*?</wp:positionV>", f'<wp:positionV relativeFrom="paragraph"><wp:posOffset>{y}</wp:posOffset></wp:positionV>', new, flags=re.S)
    new = re.sub(r"<wp:extent [^>]*/>", f'<wp:extent cx="{cx}" cy="{cy}"/>', new)
    new = re.sub(r"<a:ext [^>]*/>", f'<a:ext cx="{cx}" cy="{cy}"/>', new)
    new = re.sub(r"<a:srcRect [^>]*/>", crop, new)
    return para.replace(drawing, new)


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
            if i == 0:
                text = label(text, name)
            if "<w:drawing>" in text:
                text = logo(text, name, xml)
            opens = "".join(m for _, m in sorted(before.get(i, []), key=lambda t: -t[0]))  # outermost first
            closes = "".join(m for _, m in sorted(after.get(i, []), key=lambda t: t[0]))  # innermost first
            extra = "".join(xml_ for at, xml_ in SPACERS[name] if at == i)  # still inside any condition that closes here
            return opens + text + extra + closes

        new_xml = PARA.sub(rebuild, xml)
        out = OUT / f"{name}.docx"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "word/document.xml":
                    data = new_xml.encode("utf8")
                zout.writestr(item, data)
    return out.read_bytes()


if __name__ == "__main__":
    for template in ("internal", "external"):
        data = patch(template)
        print(f"{template}: wrote public/templates/{template}.docx ({len(data)} bytes)")
    sys.exit(0)
