# Builds docs/Stability-Assessment.pdf. The scores and text are written by hand below:
# update them when bugs are fixed or the test numbers change.
# Run from the repository root:  python docs/reports/make_stability.py docs/Stability-Assessment.pdf
import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether

OUT = sys.argv[1]
F = "C:/Windows/Fonts/"
pdfmetrics.registerFont(TTFont("Body", F + "segoeui.ttf"))
pdfmetrics.registerFont(TTFont("Body-Bold", F + "segoeuib.ttf"))
pdfmetrics.registerFont(TTFont("Body-Italic", F + "segoeuii.ttf"))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", F + "segoeuiz.ttf"))
pdfmetrics.registerFont(TTFont("Mono", F + "consola.ttf"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body-Italic", boldItalic="Body-BoldItalic")

INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
PANEL = colors.HexColor("#F9FAFB")
RED, RED_BG = colors.HexColor("#B91C1C"), colors.HexColor("#FEE2E2")
AMBER, AMBER_BG = colors.HexColor("#B45309"), colors.HexColor("#FEF3C7")
GREEN, GREEN_BG = colors.HexColor("#047857"), colors.HexColor("#D1FAE5")
BLUE = colors.HexColor("#1D4ED8")


def style(name, **kw):
    base = dict(fontName="Body", fontSize=9.5, leading=14, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)


S = {
    "title": style("title", fontName="Body-Bold", fontSize=24, leading=29),
    "subtitle": style("subtitle", fontSize=11.5, leading=15, textColor=MUTED),
    "small": style("small", fontSize=8, leading=11, textColor=MUTED),
    "h2": style("h2", fontName="Body-Bold", fontSize=12.5, leading=16, spaceBefore=2, spaceAfter=5),
    "body": style("body"),
    "cell": style("cell", fontSize=9, leading=12.5),
    "bullet": style("bullet", leftIndent=10, bulletIndent=0, spaceAfter=2.5),
    "score": style("score", fontName="Body-Bold", fontSize=44, leading=48, alignment=1),
    "scorecap": style("scorecap", fontSize=9, leading=12, alignment=1, textColor=MUTED),
}

W, H = A4
M = 17 * mm
CW = W - 2 * M


def decorate(canvas, doc):
    canvas.saveState()
    canvas.setFont("Body", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(M, 9 * mm, "Nexo InOuty backend · Stability assessment · Internal and confidential")
    canvas.drawRightString(W - M, 9 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.line(M, 12.5 * mm, W - M, 12.5 * mm)
    canvas.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=15 * mm, bottomMargin=18 * mm,
                      title="Stability Assessment: Nexo InOuty backend", author="Generated from test results",
                      subject="Stability rating based on automated tests and the bugs they found")
doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(M, 18 * mm, CW, H - 33 * mm, id="f", leftPadding=0,
                                                       rightPadding=0, topPadding=0, bottomPadding=0)], onPage=decorate)])


def table(rows, widths, header=True, zebra=True):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
          ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE)]
    if header:
        st.append(("LINEBELOW", (0, 0), (-1, 0), 0.9, INK))
    if zebra:
        st.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]))
    t.setStyle(TableStyle(st))
    return t


def P(text, s="cell"):
    return Paragraph(text, S[s])


def bullets(items):
    return [Paragraph(i, S["bullet"], bulletText="•") for i in items]


def score_box(value, caption, fg, bg):
    t = Table([[Paragraph(f'<font color="{fg.hexval()}">{value}</font>', S["score"])], [Paragraph(caption, S["scorecap"])]],
              colWidths=[CW / 3 - 4 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("TOPPADDING", (0, 0), (-1, 0), 10),
                           ("BOTTOMPADDING", (0, -1), (-1, -1), 10), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    return t


story = [
    Paragraph("Stability Assessment", S["title"]),
    Spacer(1, 2 * mm),
    Paragraph("Nexo InOuty backend (API): how stable the server is today, and what fixing the bugs would change", S["subtitle"]),
    Spacer(1, 1.5 * mm),
    Paragraph(f"{date.today():%d %B %Y} · companion to <i>Bug-Report.pdf</i> (29 bugs, details and effects)", S["small"]),
    Spacer(1, 7 * mm),
]

boxes = Table([[score_box("6.5<font size=20>/10</font>", "<b>Today</b>", AMBER, AMBER_BG),
                score_box("8–8.5<font size=20>/10</font>", "After the <b>11 most important</b> fixes", AMBER, AMBER_BG),
                score_box("9<font size=20>/10</font>", "After <b>all 29</b> bugs are fixed", GREEN, GREEN_BG)]],
              colWidths=[CW / 3] * 3)
boxes.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2)]))
story += [boxes, Spacer(1, 6 * mm)]

story += [
    Paragraph("Verdict", S["h2"]),
    Paragraph(
        "The server is in good shape where it matters most for a multi-company system: sign-in, sessions and role checks held "
        "against every attack tried, and each company's data stays separate everywhere except in one place. "
        "<b>That one place is the High bug</b>: the face-recognition machine (BUG-501) is shared by every company, so one "
        "company can pull another company's punches. The other weak spots are in <b>attendance and planning</b>: the kiosk can "
        "block a normal morning clock-in, overtime after midnight is lost, and a few actions (copying a month, clearing the "
        "machine) lose data without warning. None of these crash the server; they give wrong results quietly.", S["body"]),
    Spacer(1, 5 * mm),
    Paragraph("Score by area", S["h2"]),
]

area = [[P("<b>Area</b>"), P("<b>Score</b>"), P("<b>Why</b>")]]
for name, score, color, why in [
    ("Sign-in, sessions, roles", "9", GREEN, "All 84 routes checked against every kind of caller; forged, replayed and stolen tokens refused; accounts lock after repeated failures. Only Low bugs (BUG-101 to 104)."),
    ("Company separation", "7", AMBER, "The database layer refuses to read or change another company's records, and fails closed. The exception is the shared clocking machine (BUG-501, High)."),
    ("Employees, shifts, tasks", "7", AMBER, "Works; a manager can raise their own salary (BUG-203) and a shift still planned is deleted without warning (BUG-204)."),
    ("Work time, advances, bonuses", "6", AMBER, "Pay data is stored as sent, but the server doesn't stop a day saved twice (BUG-403) or a negative advance (BUG-401); the frontend guards both today."),
    ("Planning and exports", "6", AMBER, "Saving and copying work, but copying a month wipes days it doesn't copy (BUG-304) and the exports drop afternoon and evening shifts (BUG-306)."),
    ("Attendance, kiosk, machines", "4", RED, "The High bug, plus a blocked morning clock-in at the kiosk (BUG-504), lost overtime after midnight (BUG-505) and punches skipped after clearing the machine (BUG-502)."),
]:
    area.append([P(name), P(f'<font color="{color.hexval()}" size="12"><b>{score}</b></font>'), P(why)])
story += [table(area, [44 * mm, 16 * mm, CW - 60 * mm]), Spacer(1, 6 * mm)]

story += [Paragraph("What the score is based on", S["h2"])]
basis = [[P("<b>Evidence</b>"), P("<b>Result</b>")]]
for k, v in [
    ("Automated tests", "923 passing tests in 31 files, run against the real application and a real MongoDB database; <b>99.8%</b> of lines and 93.7% of branches covered; same result on 4 runs in a row"),
    ("Known bugs", "<b>29</b> bugs, each proven by a test that fails until it is fixed: <font color='#B91C1C'><b>1 High</b></font>, <font color='#B45309'><b>10 Medium</b></font>, <font color='#1D4ED8'><b>18 Low</b></font>"),
    ("Security checks", "Every route called without a login, as a kiosk account, manager, admin, super admin and from a company without the feature; injection, forged tokens, token theft, brute force and plain-HTTP attempts"),
    ("Continuous checks", "A GitHub Actions workflow runs lint, build and all tests with coverage thresholds on every push and pull request to <font name='Mono'>dev</font> and <font name='Mono'>main</font>"),
]:
    basis.append([P(k), P(v)])
story += [table(basis, [36 * mm, CW - 36 * mm]), Spacer(1, 6 * mm)]

two_cols = [
    [Paragraph('<font color="#047857">What earns points</font>', S["h2"]), Paragraph('<font color="#B91C1C">What costs points</font>', S["h2"])],
    [bullets([
        "Sign-in, session renewal, theft detection and role checks are solid.",
        "Company data is separated by the database layer itself, not route by route.",
        "Clear error messages in English, French and Arabic; bad input is refused, not crashed on.",
        "The clocking machine's pushes are checked, de-duplicated and stored per company.",
        "Very high test coverage and CI: a change that breaks something is caught before release.",
    ]),
     bullets([
        "<b>One company can reach another's data</b>: the shared face-recognition machine (BUG-501).",
        "<b>Wrong pay in common cases</b>: overtime after midnight lost, a day saved twice, a negative advance, a manager raising their own salary.",
        "<b>Silent data loss</b>: copying a month, punches skipped after clearing the machine, shifts deleted while planned.",
        "<b>Blocked workflow</b>: the kiosk refuses a normal morning clock-in after a day shift.",
    ])],
]
tc = Table(two_cols, colWidths=[CW / 2] * 2)
tc.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 8)]))
story += [KeepTogether([tc]), Spacer(1, 6 * mm)]

path = [[P("<b>Step</b>"), P("<b>Bugs to fix</b>"), P("<b>Expected score</b>")]]
path += [
    [P("<b>1. Close the gap between companies</b>"),
     P("BUG-501: give each company its own machine address, and refuse the machine routes to companies without one"),
     P('<font color="#B45309"><b>about 7</b></font>')],
    [P("<b>2. Stop wrong pay and data loss</b>"),
     P("The 10 Medium bugs: BUG-203, 204, 303, 304, 306, 401, 403, 502, 504, 505"),
     P('<font color="#B45309"><b>about 8–8.5</b></font>')],
    [P("<b>3. Fix the rest</b>"),
     P("The 18 Low bugs: time zones, messages, rare races, requests the app never sends"),
     P('<font color="#047857"><b>about 9</b></font>')],
    [P("<b>4. Confirm in real conditions</b>"),
     P("Watch the first pushes from the real ZKTeco machine in the server logs, and run a week of real clock-ins through the kiosk"),
     P("<b>needed for 9+</b>")],
]
story += [KeepTogether([Paragraph("How to raise the score", S["h2"]), table(path, [44 * mm, CW - 78 * mm, 34 * mm])]), Spacer(1, 6 * mm)]

story += [KeepTogether([
    Paragraph("Limits of this assessment", S["h2"]),
    Paragraph(
        "The rating covers the <b>backend</b> (the API server); the frontend has its own assessment. The tests run the real "
        "application against a real MongoDB database, but the face-recognition machine is simulated and the ZKTeco push "
        "format follows the protocol documentation, not captured traffic from the real device. Load, performance and the "
        "Render hosting set-up were not tested. Every bug listed has a test, so each fix can be confirmed objectively: when a "
        "bug is fixed, its test starts passing.", S["body"]),
])]

doc.build(story)
print("ok")
