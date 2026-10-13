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
2. Formatting (FORMAT, LOGO, BULLET, SETTINGS below):
   - the InfoBeans logo keeps its aspect ratio (cropped exactly to the artwork, box = the artwork's ratio) and sits
     directly below "A PROUD MEMBER OF", left edges aligned;
   - one bullet style for every responsibility / highlight (one numbering definition: Lexend "•" at text size, 720/360
     indent) with the same spacing between bullets;
   - a blank line between the Role line and the project description and between the description and the bullets;
   - sidebar items (internal): 1.15 line spacing inside an item, 1.5 lines from one item to the next;
   - lines ending in a manual line break are not stretched in justified paragraphs (as in Google Docs).
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
        (34, 34, "hasDescription"),  # project: (blank line, see PRE_SPACERS) + description paragraph
        (35, 37, "hasResponsibilities"),  # project: (blank line) + the bullet loop
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
# The Skills block got its gap from a blank paragraph after EVERY skill; that one is dropped (FORMAT, 44) for the
# item gap, so the block ends with one section spacer after the loop (45 = {/skills}), like the other sections.
SPACERS = {"internal": [(45, SPACER), (58, SPACER)], "external": []}

# Blank lines BEFORE a paragraph, inside any condition that opens there: the internal project had none between the
# Role / Project Link line and the description, nor between the description and the bullets. Same form as the
# project's other spacers (e.g. paragraph 26, before "Role").
PROJECT_SPACER = '<w:p><w:pPr><w:spacing w:before="0" w:line="240" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:rtl w:val="0"/></w:rPr></w:r></w:p>'
PRE_SPACERS = {"internal": [(34, PROJECT_SPACER), (35, PROJECT_SPACER)], "external": []}

# ---------------------------------------------------------------------------------------------------- 2. formatting
# 1 line of Lexend at 11pt is 1.25em = 13.75pt (its typo metrics). 1.15 lines inside an item (w:line 276), and
# 1.5 lines from item to item: 0.35 lines = 4.8pt = 96 twips after each item.
ITEM_GAP = 96
TIGHT = {"before": "0", "after": "0", "line": "276", "lineRule": "auto"}  # inside an item
ITEM = {"before": "0", "after": str(ITEM_GAP), "line": "276", "lineRule": "auto"}  # last paragraph of an item

# The one bullet: numbering definition used by every responsibility / highlight paragraph.
BULLET_NUM_ID = "1"
BULLET_LVL0 = (
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/>'
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>'
    '<w:rPr><w:rFonts w:ascii="Lexend" w:cs="Lexend" w:eastAsia="Lexend" w:hAnsi="Lexend"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:u w:val="none"/></w:rPr></w:lvl>'
)
BULLET_PPR = {
    "numPr": f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{BULLET_NUM_ID}"/></w:numPr>',
    "spacing": ITEM,
    "ind": {"left": "720", "hanging": "360"},
}

# template -> {paragraph: changes}. "spacing" / "ind": attributes (the element is replaced), "numPr": xml, "drop": True
# removes the paragraph.
FORMAT = {
    "internal": {
        36: BULLET_PPR,  # project responsibilities
        42: {"spacing": TIGHT},  # sidebar: skill name...
        43: {"spacing": ITEM},  # ...and its rating are one item
        44: {"drop": True},  # the blank paragraph after every skill (the item gap replaces it)
        48: {"spacing": ITEM},  # certification
        52: {"spacing": ITEM},  # tools (one comma-separated item)
        57: {"spacing": ITEM},  # managerial experience
        62: {"spacing": ITEM},  # domain
        67: {"spacing": ITEM},  # language
    },
    "external": {
        41: BULLET_PPR,  # project responsibilities
        54: BULLET_PPR,  # employer highlights (was its own numbering definition)
    },
}

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

# settings.xml: do not stretch a justified line that ends in a manual line break (Word's "Don't expand character
# spaces on a line ending with SHIFT+RETURN"; LibreOffice reads it too). The overview and qualification end in one.
NO_EXPAND_SHIFT_RETURN = "<w:doNotExpandShiftReturn/>"

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
    """Sets / replaces spacing, ind and numPr in the paragraph's properties, keeping the schema order."""
    m = re.search(r"<w:pPr>(.*?)</w:pPr>|<w:pPr/>", para, re.S)
    inner = m.group(1) or "" if m else ""
    children = {}
    for c in PPR_CHILD.finditer(inner):
        children[c.group(1) or c.group(2)] = c.group(0)
    if "spacing" in changes:
        children["spacing"] = f"<w:spacing {attrs(changes['spacing'])}/>"
    if "ind" in changes:
        children["ind"] = f"<w:ind {attrs(changes['ind'])}/>"
    if "numPr" in changes:
        children["numPr"] = changes["numPr"]
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


def numbering(xml: str) -> str:
    """Every abstract numbering used for bullets gets the one bullet level 0 (the paragraphs all use numId 1 anyway)."""
    return re.sub(r'<w:lvl w:ilvl="0">.*?</w:lvl>', lambda m: BULLET_LVL0 if "\u25cf" in m.group(0) else m.group(0), xml, flags=re.S)


def settings(xml: str) -> str:
    if NO_EXPAND_SHIFT_RETURN in xml:
        return xml
    return xml.replace("<w:compat>", "<w:compat>" + NO_EXPAND_SHIFT_RETURN, 1)


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
            change = FORMAT[name].get(i, {})
            if i == 0:
                text = label(text, name)
            if "<w:drawing>" in text:
                text = logo(text, name, xml)
            if change.get("drop"):
                text = ""
            elif change:
                text = set_ppr(text, change)
            opens = "".join(m for _, m in sorted(before.get(i, []), key=lambda t: -t[0]))  # outermost first
            closes = "".join(m for _, m in sorted(after.get(i, []), key=lambda t: t[0]))  # innermost first
            pre = "".join(xml_ for at, xml_ in PRE_SPACERS[name] if at == i)  # inside any condition that opens here
            extra = "".join(xml_ for at, xml_ in SPACERS[name] if at == i)  # still inside any condition that closes here
            return opens + pre + text + extra + closes

        new_xml = PARA.sub(rebuild, xml)
        out = OUT / f"{name}.docx"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "word/document.xml":
                    data = new_xml.encode("utf8")
                elif item.filename == "word/numbering.xml":
                    data = numbering(data.decode("utf8")).encode("utf8")
                elif item.filename == "word/settings.xml":
                    data = settings(data.decode("utf8")).encode("utf8")
                zout.writestr(item, data)
    return out.read_bytes()


if __name__ == "__main__":
    for template in ("internal", "external"):
        data = patch(template)
        print(f"{template}: wrote public/templates/{template}.docx ({len(data)} bytes)")
    sys.exit(0)
