# Builds docs/Bug-Report.pdf from docs/TEST_FINDINGS.md and docs/findings/*.md.
# Run from the repository root:  python docs/reports/make_bug_report.py . docs/Bug-Report.pdf
# Needs Python with reportlab (pip install reportlab) and the Segoe UI / Consolas fonts (Windows).
# Every bug needs a plain-language effect in effects.py.
import re, glob, sys, os
from collections import Counter, OrderedDict
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table,
                                TableStyle, KeepTogether, PageBreak, CondPageBreak)

sys.path.insert(0, os.path.dirname(__file__))
from effects import EFFECTS

REPO, OUT = sys.argv[1], sys.argv[2]
F = "C:/Windows/Fonts/"
pdfmetrics.registerFont(TTFont("Body", F + "segoeui.ttf"))
pdfmetrics.registerFont(TTFont("Body-Bold", F + "segoeuib.ttf"))
pdfmetrics.registerFont(TTFont("Body-Italic", F + "segoeuii.ttf"))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", F + "segoeuiz.ttf"))
pdfmetrics.registerFont(TTFont("Mono", F + "consola.ttf"))
pdfmetrics.registerFont(TTFont("Sym", F + "seguisym.ttf"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body-Italic", boldItalic="Body-BoldItalic")

INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
PANEL = colors.HexColor("#F9FAFB")
SEV = {
    "High": (colors.HexColor("#B91C1C"), colors.HexColor("#FEE2E2")),
    "Medium": (colors.HexColor("#B45309"), colors.HexColor("#FEF3C7")),
    "Low": (colors.HexColor("#1D4ED8"), colors.HexColor("#DBEAFE")),
}

AREAS = OrderedDict([
    ("docs/TEST_FINDINGS.md", "Common, tenancy & activity log"),
    ("docs/findings/auth.md", "Sign-in, users & companies"),
    ("docs/findings/staff.md", "Employees, shifts & tasks"),
    ("docs/findings/planning.md", "Planning"),
    ("docs/findings/payroll.md", "Work time, advances & bonuses"),
    ("docs/findings/attendance.md", "Attendance, kiosk & machines"),
])

# ── Parse the findings ────────────────────────────────────────────────────
FIELD = re.compile(r"^- \*\*(.+?):\*\*\s*(.*)$")
bugs = []
for path, area in AREAS.items():
    text = open(os.path.join(REPO, path), encoding="utf-8").read()
    for m in re.finditer(r"^### (BUG-\d+)\s*[:\u2014-]\s*(.+?)\n(.*?)(?=^### |^## |\Z)", text, re.M | re.S):
        fields, last = {}, None
        for line in m.group(3).splitlines():
            fm = FIELD.match(line)
            if fm:
                last = fm.group(1).strip()
                fields[last] = fm.group(2).strip()
            elif last and line.strip() and not line.startswith("#"):
                fields[last] += " " + line.strip()
        sev_full = fields.get("Severity", "Low")
        level = sev_full.split()[0].strip("(,")
        bugs.append(dict(id=m.group(1), title=m.group(2).strip(), area=area, level=level, sev=sev_full, f=fields))

missing = [b["id"] for b in bugs if b["id"] not in EFFECTS]
assert not missing, f"no effect written for {missing}"
RANK = {"High": 0, "Medium": 1, "Low": 2}
bugs.sort(key=lambda b: (RANK[b["level"]], int(b["id"][4:])))

# ── Markdown → ReportLab markup ───────────────────────────────────────────
SYMBOLS = "✓✕⚠▲▼▾⋯⌘"

def md(s):
    s = s.replace("\\|", "|").replace("\\`", "`")
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)  # links → text
    parts = re.split(r"(``.+?``|`[^`]*`)", s)
    out = []
    for p in parts:
        code = p.startswith("`") and p.endswith("`") and len(p) > 1
        if code:
            p = p[2:-2].strip() if p.startswith("``") else p[1:-1]
        p = p.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if code:
            out.append(f'<font name="Mono" size="8" color="#9F1239">{p}</font>')
        else:
            p = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", p)
            p = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", p)
            out.append(p)
    s = "".join(out)
    return "".join(f'<font name="Sym">{c}</font>' if c in SYMBOLS else c for c in s)

# ── Styles ────────────────────────────────────────────────────────────────
def style(name, **kw):
    base = dict(fontName="Body", fontSize=9, leading=12.5, textColor=INK, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    "title": style("title", fontName="Body-Bold", fontSize=26, leading=31),
    "subtitle": style("subtitle", fontSize=12, leading=16, textColor=MUTED),
    "h1": style("h1", fontName="Body-Bold", fontSize=16, leading=20, spaceBefore=4, spaceAfter=8),
    "h2": style("h2", fontName="Body-Bold", fontSize=12, leading=15, spaceAfter=4),
    "body": style("body", fontSize=9.5, leading=14),
    "small": style("small", fontSize=8, leading=11, textColor=MUTED),
    "cell": style("cell", fontSize=8.5, leading=11.5),
    "cellb": style("cellb", fontName="Body-Bold", fontSize=8.5, leading=11.5),
    "label": style("label", fontName="Body-Bold", fontSize=8, leading=11.5, textColor=MUTED),
    "value": style("value", fontSize=8.8, leading=12.3),
    "effect": style("effect", fontName="Body-Bold", fontSize=9.2, leading=12.8),
    "bugtitle": style("bugtitle", fontName="Body-Bold", fontSize=11, leading=14),
    "stat": style("stat", fontName="Body-Bold", fontSize=22, leading=26),
}

def badge(level):
    fg, bg = SEV[level]
    t = Table([[Paragraph(f'<font color="{fg.hexval()}"><b>{level.upper()}</b></font>', style("b", fontSize=7.5, leading=9, alignment=1))]],
              colWidths=[17 * mm], rowHeights=[5.2 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 1), ("RIGHTPADDING", (0, 0), (-1, -1), 1),
                           ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t

# ── Page frame ────────────────────────────────────────────────────────────
W, H = A4
M = 16 * mm

def decorate(canvas, doc):
    canvas.saveState()
    canvas.setFont("Body", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(M, 9 * mm, "Nexo InOuty backend · Bug report · Internal and confidential")
    canvas.drawRightString(W - M, 9 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.line(M, 12.5 * mm, W - M, 12.5 * mm)
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=15 * mm, bottomMargin=18 * mm,
                      title="Bug Report: Nexo InOuty backend", author="Generated from test findings",
                      subject="Bugs found while adding automated tests")
frame = Frame(M, 18 * mm, W - 2 * M, H - 33 * mm, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=decorate)])
CW = W - 2 * M

story = []

# ── Cover ─────────────────────────────────────────────────────────────────
counts = Counter(b["level"] for b in bugs)
story += [
    Spacer(1, 18 * mm),
    Paragraph("Bug Report", S["title"]),
    Spacer(1, 3 * mm),
    Paragraph("Nexo InOuty backend (API): defects found while adding automated tests", S["subtitle"]),
    Spacer(1, 2 * mm),
    Paragraph(f"{date.today():%d %B %Y} · branch <font name='Mono'>test/coverage</font>", S["small"]),
    Spacer(1, 10 * mm),
]

stat_cells = [[Paragraph(f'<font color="{INK.hexval()}">{len(bugs)}</font>', S["stat"])] +
              [Paragraph(f'<font color="{SEV[k][0].hexval()}">{counts[k]}</font>', S["stat"]) for k in ("High", "Medium", "Low")],
              [Paragraph("bugs in total", S["small"])] + [Paragraph(f"{k} severity", S["small"]) for k in ("High", "Medium", "Low")]]
st = Table(stat_cells, colWidths=[CW / 4] * 4)
st.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PANEL), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                        ("LINEBEFORE", (1, 0), (-1, -1), 0.6, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 10),
                        ("TOPPADDING", (0, 0), (-1, 0), 9), ("BOTTOMPADDING", (0, -1), (-1, -1), 9)]))
story += [st, Spacer(1, 8 * mm)]

story.append(Paragraph("About this report", S["h2"]))
for para in [
    "Every bug below was found while writing automated tests for the backend API (99.8% of lines and 93.7% of branches covered), run against the real application and a real MongoDB database. "
    "Each one is <b>proven by a test</b> that describes the correct behaviour and currently fails. "
    "The test is marked <font name='Mono'>it.failing</font> and named in the \"Proven by\" line. "
    "When a bug is fixed, its test starts passing and the test runner flags it, so the marker can be removed.",
    "<b>Severity.</b> <b>High</b>: one company can reach another company's data, or wrong pay / lost data on a main workflow for every company. "
    "<b>Medium</b>: wrong pay, lost data or a blocked workflow in specific but common situations (night shifts, a second tab, copying a month). "
    "<b>Low</b>: wrong messages, time-zone display, crashes on requests the app never sends, rare races.",
    "<b>Effect</b> says what goes wrong for the business or the user. <b>What happens</b> is the observed behaviour in the test. "
    "Some bugs are also guarded by the frontend today; they are listed because another client, an old browser tab or a direct API call still reaches them.",
]:
    story += [Paragraph(para, S["body"]), Spacer(1, 2.5 * mm)]

story += [Spacer(1, 4 * mm), Paragraph("Bugs by area", S["h2"])]
area_rows = [[Paragraph("<b>Area</b>", S["cell"])] + [Paragraph(f"<b>{k}</b>", S["cell"]) for k in ("High", "Medium", "Low")] + [Paragraph("<b>Total</b>", S["cell"])]]
for area in AREAS.values():
    c = Counter(b["level"] for b in bugs if b["area"] == area)
    area_rows.append([Paragraph(area, S["cell"])] + [Paragraph(str(c[k] or "–"), S["cell"]) for k in ("High", "Medium", "Low")] +
                     [Paragraph(f"<b>{sum(c.values())}</b>", S["cell"])])
at = Table(area_rows, colWidths=[CW * 0.48] + [CW * 0.13] * 4, repeatRows=1)
at.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, 0), 0.8, INK), ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]),
                        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
story += [at, PageBreak()]

# ── Summary table ─────────────────────────────────────────────────────────
story.append(Paragraph("All bugs at a glance", S["h1"]))
rows = [[Paragraph(f"<b>{h}</b>", S["cell"]) for h in ("ID", "Severity", "Area", "Bug")]]
for b in bugs:
    fg = SEV[b["level"]][0].hexval()
    rows.append([Paragraph(f"<b>{b['id']}</b>", S["cell"]),
                 Paragraph(f'<font color="{fg}"><b>{b["level"]}</b></font>', S["cell"]),
                 Paragraph(b["area"], S["cell"]),
                 Paragraph(md(b["title"]), S["cell"])])
t = Table(rows, colWidths=[18 * mm, 17 * mm, 40 * mm, CW - 75 * mm], repeatRows=1)
t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, 0), 0.8, INK), ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
                       ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                       ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
story += [t]

# ── Details ───────────────────────────────────────────────────────────────
ORDER = [("Effect", None), ("What happens", "Actual"), ("Steps to reproduce", "Steps / input"), ("Expected", "Expected"),
         ("Where", "Location"), ("Type", "Type"), ("Severity note", None), ("Suggested fix", "Suggested fix"), ("Proven by", "Found by")]

current = None
for b in bugs:
    if b["level"] != current:
        current = b["level"]
        fg = SEV[current][0].hexval()
        story += [PageBreak(), Paragraph(f'<font color="{fg}">{current} severity</font> · details', S["h1"]),
                  Paragraph(f"{counts[current]} bug{'s' if counts[current] != 1 else ''}, sorted by ID.", S["small"]), Spacer(1, 4 * mm)]

    head = Table([[Paragraph(f"{b['id']}", S["bugtitle"]), Paragraph(md(b["title"]), S["bugtitle"]), badge(b["level"])]],
                 colWidths=[27 * mm, CW - 48 * mm, 21 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 6),
                              ("BACKGROUND", (0, 0), (-1, -1), SEV[b["level"]][1]),
                              ("LINEBEFORE", (0, 0), (0, 0), 3, SEV[b["level"]][0]),
                              ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))

    detail = [[Paragraph("Area", S["label"]), Paragraph(b["area"], S["value"])]]
    for label, key in ORDER:
        if label == "Effect":
            val = Paragraph(md(EFFECTS[b["id"]]), S["effect"])
        elif label == "Severity note":
            note = b["sev"][len(b["level"]):].strip()
            if not note:
                continue
            val = Paragraph(md(note.strip("()")), S["value"])
        else:
            if key not in b["f"]:
                continue
            val = Paragraph(md(b["f"][key]), S["value"])
        detail.append([Paragraph(label, S["label"]), val])
    dt = Table(detail, colWidths=[30 * mm, CW - 30 * mm])
    dt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
                            ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [CondPageBreak(60 * mm), KeepTogether([head, dt]), Spacer(1, 6 * mm)]

doc.build(story)
print("bugs:", len(bugs), dict(counts))
