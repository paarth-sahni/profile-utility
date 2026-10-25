#!/usr/bin/env python3
"""
Purpose: reproducible edit of the Word templates. Reads the untouched originals from
docs/template-backups/*.before-optional-sections.docx and writes public/templates/{internal,external}.docx. Never edit the
template XML by hand: change this script and run it again. Run: python3 scripts/patch-templates.py

1. Optional sections: every OPTIONAL section disappears (heading, content and its spacer paragraph) when it has nothing
   real in it. docxtemplater loop tags ({#flag} ... {/flag}) are inserted as their own paragraphs around a block of
   paragraphs (the same way hasProjects / hasTeamSize already work); with paragraphLoop on, the tag paragraphs vanish and
   so does the whole block when the flag is false. The flags are set in lib/docxData.ts (prepareData). Two heading lines
   get an inline condition so no dangling " - " is left. The blank line after an internal project is kept only when
   another project follows (hasNext), so the projects column never ends in an empty line (no extra empty last page).
2. Formatting (FORMAT, BULLET, SETTINGS below):
   - one bullet style for every responsibility / highlight (one numbering definition: Lexend "•" at text size, 720/360
     indent) with the same spacing between bullets;
   - a blank line between the Role line and the project description and between the description and the bullets;
   - sidebar items (internal): 1.15 line spacing inside an item, 1.5 lines from one item to the next;
   - lines ending in a manual line break are not stretched in justified paragraphs (as in Google Docs).
3. Footer (both templates): logo and page number placed as in the reference (footer()).
4. The reference format (eval/reference/format.docx and format.pdf, git-ignored; LAYOUT): margins, the internal table's
   columns, "A PROUD MEMBER OF" and the logo (130.5 x 42.0pt, cropped to the artwork), the header lines, every section
   heading (Lexend Light 10pt #EA1B3D, the same space after it), body text (Lexend Light 11pt, 17.25pt lines) and the
   project lines, each font, size and position as in the reference. The internal template matches it; the external one
   keeps its own layout (one column, logo flush right) with the same rules for the same elements.
   Internal only: the grey line under the header block (RULE) and the underlined project heading line.
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
        # the blank line that ends each project separates it from the NEXT one: after the last project it was a
        # trailing empty line in the projects cell, and when the last bullet sat at the foot of a page that line alone
        # spilled onto an extra, near-empty page (only the footer: its logo and the page number)
        (38, 38, "hasNext"),
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
        (43, 44, "hasNext"),  # the blank lines that separate a project from the next one (as internal)
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

# settings.xml: do not stretch a justified line that ends in a manual line break (Word's "Don't expand character
# spaces on a line ending with SHIFT+RETURN"; LibreOffice reads it too). The overview and qualification end in one.
NO_EXPAND_SHIFT_RETURN = "<w:doNotExpandShiftReturn/>"

# ------------------------------------------------------------------------------------- 3. the reference format: footer
# eval/reference/format.docx / format.pdf (git-ignored). Positions are PDF points from the page's top left, measured on
# format.pdf; where the reference uses Avenir (the page number) we use Lexend at the same size.
PAGE_W, PAGE_H = 612.0, 792.0
# Footer logo: 24.7 x 15.0pt, its left edge 44.7pt from the page's left edge, its bottom 15.4pt above the page's bottom.
FOOT_LOGO = {"w": 24.7, "h": 15.0, "left": 44.7, "bottom": 15.4}
# Page number: Lexend at the reference's rendered size (a 14pt superscript, drawn at 8.4pt), its right edge as far from
# the page's right edge as the logo is from the left one, its digits centred on the logo's middle.
PAGE_NUMBER_PT = 8.4
# A .docx size is whole half-points, so 8.4pt cannot be written directly. Like the reference, the number is a
# superscript: LibreOffice draws a superscript at 58% of its size, so 14.5pt comes out at 8.41pt.
SUPERSCRIPT_SCALE = 0.58
SUPERSCRIPT_RISE = 6.05  # and raises it by 6.05pt at 14.5pt (measured on the PDF)
DIGIT_HEIGHT_EM = 0.7  # Lexend's figures are 0.7 em tall (measured: 5.9pt at 8.4pt)
# LibreOffice puts the baseline of an exact-height line at 80% of the line's height, whatever the font size (measured on
# Lexend 8-24pt in lines of 12-30pt); an "auto" line puts it at the font's ascent (Lexend: 1.0 em), extra height below.
EXACT_BASELINE = 0.8
PAGE_NUMBER_LINE_PT = 12.0


def emu(pt: float) -> int:
    return round(pt * EMU_PER_PT)


def marker(tag: str) -> str:
    return f'<w:p><w:r><w:t xml:space="preserve">{tag}</w:t></w:r></w:p>'


def attrs(values: dict) -> str:
    return " ".join(f'w:{k}="{v}"' for k, v in values.items())


def tw(pt: float) -> int:
    """Points to twips (1/20 pt), the unit of Word's spacing, indents and frame positions."""
    return round(pt * 20)


def footer(xml: str) -> str:
    """The footer: the logo and the page number at fixed places on the page (both anchored to the page, so neither the
    footer distance nor the body text moves them), plus one 1pt empty line so the footer takes no room from the body."""
    root = re.search(r"<w:ftr\b[^>]*>", xml).group(0)
    lw, lh = FOOT_LOGO["w"], FOOT_LOGO["h"]
    logo_top = PAGE_H - FOOT_LOGO["bottom"] - lh
    drawing = (
        '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="1" layoutInCell="1" allowOverlap="1">'
        '<wp:simplePos x="0" y="0"/>'
        f'<wp:positionH relativeFrom="page"><wp:posOffset>{emu(FOOT_LOGO["left"])}</wp:posOffset></wp:positionH>'
        f'<wp:positionV relativeFrom="page"><wp:posOffset>{emu(logo_top)}</wp:posOffset></wp:positionV>'
        f'<wp:extent cx="{emu(lw)}" cy="{emu(lh)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>'
        '<wp:docPr id="101" name="footer logo"/><wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
        '<pic:nvPicPr><pic:cNvPr id="0" name="footer logo"/><pic:cNvPicPr preferRelativeResize="0"/></pic:nvPicPr>'
        '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect l="0" t="0" r="0" b="0"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu(lw)}" cy="{emu(lh)}"/></a:xfrm><a:prstGeom prst="rect"/><a:ln/></pic:spPr>'
        "</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>"
    )
    # the page number: a frame on the page whose right edge mirrors the logo's left edge; one exact line, right-aligned
    frame_w = 40.0
    right = PAGE_W - FOOT_LOGO["left"]
    baseline = logo_top + lh / 2 + DIGIT_HEIGHT_EM * PAGE_NUMBER_PT / 2
    # the superscript is drawn SUPERSCRIPT_RISE above the line's baseline, so the line sits that much lower
    frame_top = baseline + SUPERSCRIPT_RISE - EXACT_BASELINE * PAGE_NUMBER_LINE_PT
    size = round(PAGE_NUMBER_PT / SUPERSCRIPT_SCALE * 2)  # half-points
    rpr = f'<w:rPr><w:rFonts w:ascii="Lexend" w:cs="Lexend" w:eastAsia="Lexend" w:hAnsi="Lexend"/><w:b w:val="0"/><w:bCs w:val="0"/><w:color w:val="231F20"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/><w:vertAlign w:val="superscript"/></w:rPr>'
    number = (
        "<w:p><w:pPr>"
        f'<w:framePr w:w="{tw(frame_w)}" w:h="{tw(PAGE_NUMBER_LINE_PT)}" w:hRule="exact" w:wrap="notBeside" w:vAnchor="page" w:hAnchor="page" w:x="{tw(right - frame_w)}" w:y="{tw(frame_top)}"/>'
        f'<w:spacing w:before="0" w:after="0" w:line="{tw(PAGE_NUMBER_LINE_PT)}" w:lineRule="exact"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="right"/>{rpr}</w:pPr>'
        f'<w:r>{rpr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>{rpr}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
        f'<w:r>{rpr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>{rpr}<w:t>1</w:t></w:r><w:r>{rpr}<w:fldChar w:fldCharType="end"/></w:r></w:p>'
    )
    tiny = '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>'
    carrier = f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/>{tiny}</w:pPr><w:r>{tiny}{drawing}</w:r></w:p>'
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n{root}{number}{carrier}</w:ftr>'


# --------------------------------------------------------------- 4. the reference format: header, headings and text
# Fonts, sizes and colours from format.docx; positions from format.pdf. Lines that must land on a measured position
# get an EXACT height, so the baseline is predictable (EXACT_BASELINE); each spacing value below is computed from the
# reference position it produces, so changing a target changes the layout.
# Margins (format.docx): top 0.4in, left / right / bottom 0.6in, header 0, footer 0.5in.
MARGINS = {"top": 576, "right": 864, "bottom": 864, "left": 864, "header": 0, "footer": 720, "gutter": 0}
PAGE_TOP = MARGINS["top"] / 20
MARGIN_LEFT = MARGINS["left"] / 20
TEXT_RIGHT = PAGE_W - MARGINS["right"] / 20
# Internal table as in format.docx: columns of 7170 + 3300 twips; a 6-twip indent puts the text at x = 50.7 / 409.2.
GRID = {"internal": (6, 7170, 3300)}
CELL_TOP = 7.2  # the table cells' top margin (144 twips); the external name paragraph gets the same space above it
ROW1_MIN = 107.0  # internal: the header row is at least 2140 twips tall, so row 2 (Overview, Skills) starts below it
LEXEND_ASCENT = 1.0  # em: the baseline of an "auto" line sits this far below its top
AUTO_LINE_EM = 1.25  # em: Lexend's single line height (ascent 1.0 + descent 0.25)

# "A PROUD MEMBER OF": Lexend (the reference's Avenir) 8pt, #666666, baseline 44.4 (its "top", baseline - 6, is 38.4).
LABEL = {"size": 8, "color": "666666", "baseline": 44.4, "line": 10.0}
# The logo artwork 130.5 x 42.0pt, top 59.25 (12.8pt below the label); its left edge 0.5pt right of the label's.
LOGO = {"w": 130.5, "h": 42.0, "top": 59.25}
LOGO_X = {"internal": 412.2, "external": TEXT_RIGHT - LOGO["w"]}  # external (one column): flush with the right margin
LABEL_X = {k: x - 0.5 for k, x in LOGO_X.items()}  # internal: 411.7 as in the reference
# Header lines: baselines (reference: name top 59.0, job title top 91.0, first experience line top 109.3).
NAME_BASELINE, TITLE_BASELINE, EXPERIENCE_BASELINE, SPECIALIZATION_BASELINE = 77.0, 100.0, 117.6, 134.8
# Section headings: Lexend Light 10pt #EA1B3D. The first ones (Overview, Skills) sit at baseline 189.6 (top 182.1); the
# first line after every heading starts 24.2pt below the heading's top (Overview 182.1 -> text 206.3).
HEADING = {"font": "Lexend Light", "size": 10, "color": "EA1B3D", "line": 15.0}
FIRST_HEADING_BASELINE = 189.6
HEADING_TO_TEXT_TOP = 24.2
TOP_EM = 0.75  # the targets' "top" of a line is baseline - 0.75 x size
# From the last line of a section to the next heading (reference: Overview text -> Education & Training).
SECTION_GAP = 46.3
# Body text (overview, descriptions, the qualification): Lexend Light 11pt, 1.3 lines as the reference renders them.
BODY_LINE = 17.25
# Project: heading -> name 16.5, name -> first label 24.0, label -> value 15.0, value -> next label / description 25.5,
# from the last line of a project to the next project's heading 54.7.
FIELD_LINE = 15.0
PROJECT = {"to_name": 16.5, "to_first_label": 24.0, "to_label": 25.5, "to_description": 25.5, "to_next": 54.7}
YEAR_TO_QUALIFICATION = 17.5
SPACER_LINE = 12.0  # the blank paragraphs between sections (external, internal sidebar)
DARK, TEXT = "373742", "231F20"  # name / headings / labels, and field values (format.docx)


def exact(line_pt: float, before: float = 0, after: float = 0) -> dict:
    return {"before": str(tw(before)), "after": str(tw(after)), "line": str(tw(line_pt)), "lineRule": "exact"}


def below(line_pt: float) -> float:
    """From the baseline of an exact line to its bottom."""
    return (1 - EXACT_BASELINE) * line_pt


def auto_below(size: float, lines: float) -> float:
    """From the baseline of an "auto" line (`lines` x single) of Lexend at `size` to its bottom."""
    return lines * AUTO_LINE_EM * size - LEXEND_ASCENT * size


def run(font: str, size: float, color: str, underline: bool = False) -> dict:
    return {"font": font, "size": size, "color": color, "underline": underline}


def header_layout(template: str) -> dict:
    """Label, name, job title and the two header lines; returns {paragraph: changes} and the logo's offsets."""
    label_before = LABEL["baseline"] - PAGE_TOP - EXACT_BASELINE * LABEL["line"]
    label_bottom = PAGE_TOP + label_before + LABEL["line"]
    name_top = label_bottom + CELL_TOP  # internal: the cell's top margin; external: space before the paragraph
    lines, top = [], name_top
    for baseline in (NAME_BASELINE, TITLE_BASELINE, EXPERIENCE_BASELINE, SPECIALIZATION_BASELINE):
        line = tw((baseline - top) / EXACT_BASELINE) / 20  # what the .docx can hold (whole twips)
        lines.append(line)
        top += line
    name_before = CELL_TOP if template == "external" else 0
    layout = {
        0: {"spacing": exact(LABEL["line"], before=label_before), "run": run("Lexend", LABEL["size"], LABEL["color"])},
        1: {"spacing": exact(lines[0], before=name_before), "run": run("Lexend Medium", 24, DARK)},
        2: {"spacing": exact(lines[1]), "run": run("Lexend", 12, DARK)},
        3: {"spacing": exact(lines[2]), "run": run("Lexend Light", 11, DARK)},
        4: {"spacing": exact(lines[3]), "run": run("Lexend Light", 11, DARK)},
    }
    return {"paragraphs": layout, "header_bottom": top, "label_bottom": label_bottom, "name_top": name_top, "lines": lines}


def heading(before: float, content: str) -> dict:
    """A section heading whose first content line starts HEADING_TO_TEXT_TOP below the heading's top. `content` is how
    that first line is laid out: "exact" (a BODY_LINE line) or "auto" (an 11pt item, 1.15 lines)."""
    to_baseline = HEADING_TO_TEXT_TOP - TOP_EM * HEADING["size"] + TOP_EM * 11
    first = EXACT_BASELINE * BODY_LINE if content == "exact" else LEXEND_ASCENT * 11
    return {"spacing": exact(HEADING["line"], before=before, after=to_baseline - below(HEADING["line"]) - first), "run": run(HEADING["font"], HEADING["size"], HEADING["color"])}


def section_before(previous_below: float, spacers: int = 0) -> float:
    """`before` of a heading so its baseline is SECTION_GAP below the previous section's last baseline."""
    return SECTION_GAP - previous_below - spacers * SPACER_LINE - EXACT_BASELINE * HEADING["line"]


# The thin grey line under the header block (internal): format.pdf draws a #888888 stroke 1.0pt wide from x 54.0 to
# 541.0 with its centre at y 146.5. It is the bottom border of an empty paragraph at the end of the header cell.
RULE = {"color": "888888", "width": 1.0, "x0": 54.0, "x1": 541.0, "y": 146.5}
CELL_TEXT_RIGHT = MARGIN_LEFT + (GRID["internal"][0] + GRID["internal"][1] + GRID["internal"][2]) / 20 - CELL_TOP  # the header cell's text edge


def rule_paragraph(header_bottom: float) -> str:
    """The empty paragraph whose bottom border is the rule: it fills the space from the last header line down to the
    border's top edge, and is indented so the border runs from RULE x0 to x1."""
    top_edge = RULE["y"] - RULE["width"] / 2
    left = RULE["x0"] - (MARGIN_LEFT + GRID["internal"][0] / 20 + CELL_TOP)
    right = CELL_TEXT_RIGHT - RULE["x1"]
    border = f'<w:pBdr><w:bottom w:val="single" w:sz="{round(RULE["width"] * 8)}" w:space="0" w:color="{RULE["color"]}"/></w:pBdr>'
    return (
        f'<w:p><w:pPr>{border}<w:spacing {attrs(exact(top_edge - header_bottom))}/>'
        f'<w:ind w:left="{tw(left)}" w:right="{tw(right)}" w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:p>'
    )


# What each kind of paragraph looks like (the run formatting of every run in it).
BODY = {"spacing": exact(BODY_LINE), "run": run("Lexend Light", 11, DARK), "ind": {"left": "0", "right": "0", "firstLine": "0"}, "jc": "both", "no_break": True}
PROJECT_HEADING = {"spacing": exact(BODY_LINE), "run": run("Lexend", 11, DARK)}
# Internal only: the whole "Project N - <dates>" line is underlined (format.docx: <w:u w:val="single"/>)
PROJECT_HEADING_UNDERLINED = {**PROJECT_HEADING, "run": run("Lexend", 11, DARK, underline=True)}
PROJECT_NAME_LINE = tw((PROJECT["to_name"] - below(BODY_LINE)) / EXACT_BASELINE) / 20
PROJECT_NAME = {"spacing": exact(PROJECT_NAME_LINE), "run": run("Lexend Light", 11, TEXT)}
LABEL_LINE = {"spacing": exact(FIELD_LINE), "run": run("Lexend", 11, DARK)}
VALUE_LINE = {"spacing": exact(FIELD_LINE), "run": run("Lexend Light", 11, TEXT)}
# blank paragraphs inside a project
FIRST_LABEL_GAP = PROJECT["to_first_label"] - below(PROJECT_NAME_LINE) - EXACT_BASELINE * FIELD_LINE
LABEL_GAP = PROJECT["to_label"] - below(FIELD_LINE) - EXACT_BASELINE * FIELD_LINE
DESCRIPTION_GAP = PROJECT["to_description"] - below(FIELD_LINE) - EXACT_BASELINE * BODY_LINE
# a project ends in bullets (1.15 lines, 4.8pt after each: ITEM)
BULLET_BELOW = auto_below(11, 1.15) + ITEM_GAP / 20
NEXT_PROJECT_GAP = PROJECT["to_next"] - BULLET_BELOW - EXACT_BASELINE * BODY_LINE
SIDEBAR_ITEM_BELOW = BULLET_BELOW  # sidebar items use the same 1.15 lines + ITEM_GAP


def blank(height: float) -> dict:
    return {"spacing": exact(height), "no_numbering": True}


def blank_xml(height: float) -> str:
    return f'<w:p><w:pPr><w:spacing {attrs(exact(height))}/><w:jc w:val="left"/></w:pPr></w:p>'


def internal_layout() -> dict:
    h = header_layout("internal")
    row2_top = max(h["label_bottom"] + ROW1_MIN, h["header_bottom"])
    first_heading_before = FIRST_HEADING_BASELINE - (row2_top + CELL_TOP) - EXACT_BASELINE * HEADING["line"]
    main_section = section_before(below(BODY_LINE))
    side_section = section_before(SIDEBAR_ITEM_BELOW, spacers=1)
    layout = dict(h["paragraphs"])
    layout.update({
        5: heading(first_heading_before, "exact"),  # Overview
        6: BODY,  # overview
        7: heading(main_section, "exact"),  # Education & Training
        9: {"spacing": exact(BODY_LINE), "run": run("Lexend Light", 11, DARK)},  # year
        10: {**BODY, "spacing": exact(BODY_LINE, before=YEAR_TO_QUALIFICATION - BODY_LINE), "jc": "left"},  # qualification
        13: heading(main_section, "exact"),  # Projects
        16: PROJECT_HEADING_UNDERLINED,
        17: PROJECT_NAME,
        18: blank(FIRST_LABEL_GAP),  # (hasTech) before "Tools & Technologies"
        19: LABEL_LINE, 20: VALUE_LINE,
        22: blank(LABEL_GAP), 23: LABEL_LINE, 24: VALUE_LINE,  # Team Size
        26: blank(LABEL_GAP), 27: LABEL_LINE, 28: VALUE_LINE,  # Role
        30: blank(LABEL_GAP), 31: LABEL_LINE, 32: VALUE_LINE,  # Project Link
        34: BODY,  # description (its blank line before it: DESCRIPTION_SPACER)
        38: blank(NEXT_PROJECT_GAP),  # (hasNext) between projects
        40: heading(first_heading_before, "auto"),  # Skills
        42: {"run": run("Lexend", 11, DARK)},  # skill name
        43: {"run": run("Lexend Light", 11, DARK)},  # rating
        46: heading(side_section, "auto"), 50: blank(SPACER_LINE),  # Certifications
        51: heading(side_section, "auto"), 53: blank(SPACER_LINE),  # Tools
        55: heading(side_section, "auto"),  # Managerial Experience (its spacer: SPACERS)
        60: heading(side_section, "auto"), 64: blank(SPACER_LINE),  # Domain
        65: heading(side_section, "auto"),  # Languages
    })
    for i in (48, 52, 57, 62, 67):  # sidebar items
        layout[i] = {"run": run("Lexend Light", 11, DARK)}
    return {"paragraphs": layout, "name_top": h["name_top"]}


def external_layout() -> dict:
    h = header_layout("external")
    first_heading_before = FIRST_HEADING_BASELINE - h["header_bottom"] - 2 * SPACER_LINE - EXACT_BASELINE * HEADING["line"]
    section = section_before(below(BODY_LINE), spacers=1)
    layout = dict(h["paragraphs"])
    layout.update({
        5: blank(SPACER_LINE), 6: blank(SPACER_LINE),
        7: heading(first_heading_before, "exact"), 8: BODY,  # Overview
        9: blank(SPACER_LINE), 10: heading(section, "exact"),  # Education & Training
        12: {"spacing": exact(BODY_LINE), "run": run("Lexend Light", 11, DARK)},  # year
        13: {**BODY, "spacing": exact(BODY_LINE, before=YEAR_TO_QUALIFICATION - BODY_LINE), "jc": "left"},  # qualification
        15: blank(SPACER_LINE), 16: heading(section, "exact"), 17: BODY,  # Skills
        18: blank(SPACER_LINE), 19: heading(section, "exact"), 20: BODY,  # Tools
        21: blank(SPACER_LINE), 22: heading(section, "exact"), 23: BODY,  # Certifications
        24: blank(SPACER_LINE), 25: heading(section, "exact"),  # Projects/Experience
        27: PROJECT_HEADING,
        28: PROJECT_NAME,
        30: blank(FIRST_LABEL_GAP), 31: LABEL_LINE, 32: VALUE_LINE,  # Team Size
        34: blank(LABEL_GAP), 35: LABEL_LINE, 36: VALUE_LINE,  # Role
        37: blank(DESCRIPTION_GAP), 38: BODY,  # description
        39: {"spacing": {"before": "0", "after": "0", "line": "240", "lineRule": "auto"}},  # blank line before the bullets
        43: blank(NEXT_PROJECT_GAP), 44: {"drop": True},  # (hasNext) between projects
        46: {"drop": True}, 47: heading(section, "exact"),  # Experience (the spacer before it: END_OF_PROJECTS)
        49: PROJECT_HEADING,  # employer
        50: VALUE_LINE, 51: VALUE_LINE,  # position, duration
    })
    return {"paragraphs": layout, "name_top": h["name_top"] - CELL_TOP}


LAYOUT = {"internal": internal_layout(), "external": external_layout()}
_HEADER = header_layout("internal")
# The internal description's blank line before it (PRE_SPACERS) sized like the other project gaps, and the two sidebar
# spacers (SPACERS) like the other sidebar spacers.
PRE_SPACERS["internal"][0] = (34, blank_xml(DESCRIPTION_GAP))
SPACERS["internal"] = [(at, blank_xml(SPACER_LINE)) for at, _ in SPACERS["internal"]]
# External: the Experience heading follows either the last project (its bullets) or another section's spacer. After the
# LAST project only ({^hasNext}), a blank line makes the bullets end where a section's spacer ends, so the heading is
# SECTION_GAP below either. Added after paragraph 44, outside its {/hasNext}.
END_OF_PROJECTS = blank_xml(below(BODY_LINE) + SPACER_LINE - BULLET_BELOW)
# Internal: the rule after the specialisation line. An empty experience / specialisation line leaves a blank line of its
# own height ({^hasX}), so the rule stays where the reference has it whatever the header holds.
AFTER_CLOSE = {
    "internal": [
        (3, marker("{^hasExperienceSummary}") + blank_xml(_HEADER["lines"][2]) + marker("{/hasExperienceSummary}")),
        (4, marker("{^hasSpecialization}") + blank_xml(_HEADER["lines"][3]) + marker("{/hasSpecialization}") + rule_paragraph(_HEADER["header_bottom"])),
    ],
    "external": [(44, marker("{^hasNext}") + END_OF_PROJECTS + marker("{/hasNext}"))],
}


PARA = re.compile(r"<w:p[ >].*?</w:p>", re.S)
PPR_ORDER = [
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers",
    "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE",
    "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents",
    "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle",
    "rPr", "sectPr", "pPrChange",
]
PPR_CHILD = re.compile(r"<w:(rPr|numPr|tabs|pBdr|sectPr|pPrChange|framePr)\b[^>]*?(?:/>|>.*?</w:\1>)|<w:(\w+)\b[^>]*/>", re.S)


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
    if changes.get("no_numbering"):
        children.pop("numPr", None)
    if "jc" in changes:
        children["jc"] = f'<w:jc w:val="{changes["jc"]}"/>'
    ppr = "<w:pPr>" + "".join(children[k] for k in sorted(children, key=lambda k: PPR_ORDER.index(k) if k in PPR_ORDER else 99)) + "</w:pPr>"
    if m:
        return para[: m.start()] + ppr + para[m.end() :]
    head = re.match(r"<w:p[^>]*>", para).group(0)
    return head + ppr + para[len(head) :]


RPR_ORDER = [
    "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss",
    "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs",
    "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout",
    "specVanish", "oMath",
]
RPR_CHILD = re.compile(r"<w:(\w+)\b[^>]*?(?:/>|>.*?</w:\1>)", re.S)


def rpr(inner: str, font: str, size: float, color: str, underline: bool = False) -> str:
    """Run properties with this font (all four scripts, not bold), size and colour, keeping the rest, in schema order."""
    children = {m.group(1): m.group(0) for m in RPR_CHILD.finditer(inner)}
    children["rFonts"] = f'<w:rFonts w:ascii="{font}" w:cs="{font}" w:eastAsia="{font}" w:hAnsi="{font}"/>'
    children["b"], children["bCs"] = '<w:b w:val="0"/>', '<w:bCs w:val="0"/>'
    children["color"] = f'<w:color w:val="{color}"/>'
    children["sz"], children["szCs"] = f'<w:sz w:val="{round(size * 2)}"/>', f'<w:szCs w:val="{round(size * 2)}"/>'
    if underline:
        children["u"] = '<w:u w:val="single"/>'  # as in the reference (a single line in the text colour)
    else:
        children.pop("u", None)
    return "<w:rPr>" + "".join(children[k] for k in sorted(children, key=lambda k: RPR_ORDER.index(k) if k in RPR_ORDER else 99)) + "</w:rPr>"


def set_runs(para: str, font: str, size: float, color: str, underline: bool = False) -> str:
    """Every run of the paragraph, and its paragraph mark, in this font, size and colour (digits included: a run's
    font covers every character, so no number can fall back to another font)."""
    def fix(m: re.Match) -> str:
        r = m.group(0)
        props = re.search(r"<w:rPr>(.*?)</w:rPr>|<w:rPr/>", r, re.S)
        new = rpr(props.group(1) or "" if props else "", font, size, color, underline)
        if props:
            return r[: props.start()] + new + r[props.end() :]
        head = re.match(r"<w:r\b[^>]*>", r).group(0)
        return head + new + r[len(head) :]

    para = re.sub(r"<w:r\b(?:\s[^>]*)?>.*?</w:r>", fix, para, flags=re.S)
    ppr = re.search(r"<w:pPr>.*?</w:pPr>", para, re.S)
    if ppr:
        mark = re.search(r"<w:rPr>(.*?)</w:rPr>|<w:rPr/>", ppr.group(0), re.S)
        new_mark = rpr(mark.group(1) or "" if mark else "", font, size, color, underline)
        new_ppr = ppr.group(0)[: mark.start()] + new_mark + ppr.group(0)[mark.end() :] if mark else ppr.group(0).replace("</w:pPr>", new_mark + "</w:pPr>")
        para = para[: ppr.start()] + new_ppr + para[ppr.end() :]
    return para


def table_grid(xml: str, name: str) -> str:
    """The internal table's indent and column widths as in format.docx (the sidebar text starts at x = 409.2)."""
    if name not in GRID:
        return xml
    ind, main, side = GRID[name]
    xml = re.sub(r'<w:tblW w:w="[\d.]+" w:type="dxa"/>', f'<w:tblW w:w="{main + side}" w:type="dxa"/>', xml, count=1)
    xml = re.sub(r'<w:tblInd w:w="[\d.]+" w:type="dxa"/>', f'<w:tblInd w:w="{ind}" w:type="dxa"/>', xml, count=1)
    return re.sub(r'<w:gridCol w:w="\d+"/><w:gridCol w:w="\d+"/>', f'<w:gridCol w:w="{main}"/><w:gridCol w:w="{side}"/>', xml)


def page_margins(xml: str) -> str:
    """The section's page margins as in format.docx (both templates)."""
    return re.sub(r"<w:pgMar [^>]*/>", f"<w:pgMar {attrs(MARGINS)}/>", xml)


def label(para: str, name: str) -> str:
    """'A PROUD MEMBER OF': no tabs or padding spaces, starting at LABEL_X (just left of the logo, as in the reference)."""
    para = para.replace("<w:tab/>", "")
    para = re.sub(r"(<w:t[^>]*>)([^<]*)(</w:t>)", lambda t: t.group(1) + t.group(2).strip() + t.group(3), para)
    return set_ppr(para, {"ind": {"left": str(tw(LABEL_X[name] - MARGIN_LEFT)), "right": "0", "firstLine": "0"}, "jc": "left"})


def cell_left_pt(xml: str) -> float:
    """Where text starts in the first table cell, from the page margin (0 without a table)."""
    table = re.search(r"<w:tbl>.*?<w:tc>.*?</w:tcPr>", xml, re.S)
    if not table:
        return 0.0
    ind = re.search(r'<w:tblInd w:w="([\d.]+)" w:type="dxa"/>', table.group(0))
    mar = re.search(r'<w:tcMar>.*?<w:left w:w="([\d.]+)" w:type="dxa"/>', table.group(0), re.S)
    return (float(ind.group(1)) if ind else 0) / 20 + (float(mar.group(1)) if mar else 0) / 20


def logo(para: str, name: str, xml: str) -> str:
    """The anchored logo: cropped to the artwork, drawn at the reference's 130.5 x 42.0pt (the artwork is 2.4% wider for
    its height than that box; the reference squeezes its own copy of the logo the same way), at LOGO_X, LOGO["top"]."""
    l, t, r, b = ART
    w, h = ART_SIZE
    cx, cy = emu(LOGO["w"]), emu(LOGO["h"])
    crop = f'<a:srcRect l="{round(l / w * 100000)}" t="{round(t / h * 100000)}" r="{round((w - r) / w * 100000)}" b="{round((h - b) / h * 100000)}"/>'
    # horizontal: from the text column the anchor is in. In the internal template that is the table cell holding the
    # name (Word and LibreOffice agree on that), whose text starts tblInd + the cell's left margin from the page margin.
    x = emu(LOGO_X[name] - MARGIN_LEFT - cell_left_pt(table_grid(xml, name)))  # the table as patched
    # vertical: from the top of the paragraph the logo is anchored in (the name)
    y = emu(LOGO["top"] - LAYOUT[name]["name_top"])
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
            change = {**LAYOUT[name]["paragraphs"].get(i, {}), **FORMAT[name].get(i, {})}
            if "run" in change:
                text = set_runs(text, **change["run"])
            if change.get("no_break"):
                # the template's own trailing line break (a {tag}'s line breaks come in when it is filled)
                text = re.sub(r"<w:br\b[^>]*/>", "", text)
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
            post = "".join(xml_ for at, xml_ in AFTER_CLOSE[name] if at == i)  # outside every condition that closes here
            return opens + pre + text + extra + closes + post

        new_xml = page_margins(table_grid(PARA.sub(rebuild, xml), name))
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
                elif item.filename == "word/footer1.xml":
                    data = footer(data.decode("utf8")).encode("utf8")
                zout.writestr(item, data)
    return out.read_bytes()


if __name__ == "__main__":
    for template in ("internal", "external"):
        data = patch(template)
        print(f"{template}: wrote public/templates/{template}.docx ({len(data)} bytes)")
    sys.exit(0)
