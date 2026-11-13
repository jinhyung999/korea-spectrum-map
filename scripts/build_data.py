"""대한민국 주파수 분배표 고시 붙임 파일(hwpx)을 data/allocations.json으로 변환한다.

분배표는 83개의 표로 나뉘어 있고, 각 표 위에 "44－108 ㎒"처럼 범위와 단위를 적은
제목 문단이 있다. 표의 (1)~(3)란은 ITU 지역별 분배, (4)란은 대한민국 분배,
(5)란은 용도다. 이 스크립트는 (4)·(5)란만 읽는다.

원문의 규칙(붙임 1. 주파수 분배표 설명):
  - 업무 이름에 밑줄이 없으면 1순위, 있으면 2순위 업무다.
  - 업무 오른쪽에 붙은 주석은 그 업무에만, 칸 아래쪽에 따로 적힌 주석은
    그 대역의 모든 업무에 적용된다. K로 시작하면 국내 주석이다.

사용법: python scripts/build_data.py [--report]
표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "source" / "kfat_notice_2024-44.hwpx"
OUTPUT = ROOT / "data" / "allocations.json"
FOOTNOTES_OUTPUT = ROOT / "data" / "footnotes.json"

SOURCE_INFO = {
    "title": "대한민국 주파수 분배표",
    "notice": "과학기술정보통신부고시 제2024-44호",
    "effective": "2025-02-17",
    "url": "https://www.law.go.kr/행정규칙/대한민국주파수분배표",
}

# 원문의 오기를 바로잡은 곳. 원문 표기와 근거를 함께 남긴다.
CORRECTIONS = {
    "399.9-400.5 ㎒": {
        "range": ("399.9", "400.05"),
        "reason": "원문 (4)란에는 399.9-400.5로 적혀 있으나, 같은 줄의 국제 분배"
        "(1~3란)가 399.9-400.05이고 다음 대역이 400.05에서 시작한다.",
    },
}

# 주석이 업무 바로 아랫줄에 빈 줄 없이 적혀 있어 규칙대로면 그 업무의 주석이 되지만,
# 주석 본문을 보면 대역 전체에 대한 내용이라 대역 주석으로 옮기는 곳.
BAND_NOTE_OVERRIDES = {
    "472-479 ㎑": {
        "notes": ["5.82", "5.80B"],
        "reason": "칸이 좁아 아마추어 바로 아랫줄에 적혀 있으나, 5.82는 해상이동·항공무선항행·"
        "아마추어 모두에 대한 조건이고 5.80B는 이 대역의 국가별 사용 제한이다.",
    },
    "13550-13570 ㎑": {
        "notes": ["5.150"],
        "reason": "5.150은 이 대역을 ISM용으로 지정하고 대역 안의 모든 전파통신업무에 적용된다.",
    },
    "26350-27500 ㎑": {
        "notes": ["5.150"],
        "reason": "5.150은 이 대역을 ISM용으로 지정하고 대역 안의 모든 전파통신업무에 적용된다.",
    },
}

# 8.3 ㎑ 이하는 "미분배"로만 적혀 있어 대역 목록에 넣지 않는다.
UNALLOCATED_BELOW = ("8.3", "㎑")

UNIT_HZ = {"㎑": Decimal(10) ** 3, "㎒": Decimal(10) ** 6, "㎓": Decimal(10) ** 9}

DASH = r"[-－–~∼]"
HEADING_RE = re.compile(rf"([\d.,]+)\s*{DASH}\s*([\d.,]+)\s*(㎑|㎒|㎓)")
RANGE_RE = re.compile(rf"^\s*([\d.,]+)\s*{DASH}\s*([\d.,]+)\s*$")
NOTE_RE = re.compile(r"(?<![\d.A-Za-z])(?:5\.\d{1,3}[A-Z]{0,3}|K\d{1,3}[A-Z]{0,2})(?![\dA-Za-z])")
NOTES_ONLY_RE = re.compile(rf"^(?:{NOTE_RE.pattern}[\s,]*)+$")
TRAILING_NOTES_RE = re.compile(rf"((?:[\s,]+{NOTE_RE.pattern})+)[\s,]*$")


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child(elem, name):
    return next(c for c in elem if local(c.tag) == name)


def underlined_char_styles(header_xml: bytes) -> set[str]:
    """밑줄이 있는 글자 모양 id. 2순위 업무 판별에 쓴다."""
    ids = set()
    for elem in ET.fromstring(header_xml).iter():
        if local(elem.tag) != "charPr":
            continue
        for c in elem:
            if local(c.tag) == "underline" and c.get("type", "NONE") != "NONE":
                ids.add(elem.get("id"))
    return ids


def paragraph_chars(p, underlined: set[str], skip_tables: bool = False):
    """문단의 글자와, 글자마다 밑줄 여부를 돌려준다."""
    text, flags = [], []

    def walk(elem, is_ul):
        for c in elem:
            name = local(c.tag)
            if name == "tbl" and skip_tables:
                continue
            if name == "run":
                walk(c, c.get("charPrIDRef") in underlined)
            elif name == "t":
                s = "".join(c.itertext())
                text.append(s)
                flags.extend([is_ul] * len(s))
            else:
                walk(c, is_ul)

    walk(p, False)
    return "".join(text), flags


def table_cells(tbl, underlined):
    cells = []
    for tr in tbl:
        if local(tr.tag) != "tr":
            continue
        for tc in tr:
            if local(tc.tag) != "tc":
                continue
            addr, span = child(tc, "cellAddr"), child(tc, "cellSpan")
            paras = [
                paragraph_chars(p, underlined)
                for p in child(tc, "subList")
                if local(p.tag) == "p"
            ]
            cells.append(
                {
                    "row": int(addr.get("rowAddr")),
                    "col": int(addr.get("colAddr")),
                    "rowspan": int(span.get("rowSpan")),
                    "paras": paras,
                }
            )
    return cells


def clean_name(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s.replace(") (", ")(")


def is_primary(flags) -> bool:
    """밑줄은 괄호 앞의 업무 이름에만 그어진다. 그 부분으로 순위를 정한다."""
    return sum(flags) <= len(flags) / 2


def paragraph_segments(text, flags):
    """한 문단을 (이름 조각, 밑줄 표시, 뒤따르는 주석) 묶음으로 나눈다.

    "고정 5.410 이동(항공이동 제외)"처럼 한 줄에 업무가 둘 들어간 곳이 있어서
    주석 번호를 경계로 자른다. 이름 없이 주석으로 시작하면 첫 조각의 이름이 빈다.
    """
    segments = []
    pos = 0
    for m in NOTE_RE.finditer(text):
        chunk = text[pos : m.start()]
        if chunk.strip(" ,	"):
            lead = len(chunk) - len(chunk.lstrip())
            base_end = chunk.find("(", lead)
            base_end = len(chunk.rstrip()) if base_end < 0 else base_end
            segments.append(
                {"name": chunk, "flags": flags[pos + lead : pos + base_end], "notes": []}
            )
        elif not segments:
            segments.append({"name": "", "flags": [], "notes": []})
        segments[-1]["notes"].append(m.group())
        pos = m.end()
    tail = text[pos:]
    if tail.strip(" ,	"):
        lead = len(tail) - len(tail.lstrip())
        base_end = tail.find("(", lead)
        base_end = len(tail.rstrip()) if base_end < 0 else base_end
        segments.append(
            {"name": tail, "flags": flags[pos + lead : pos + base_end], "notes": []}
        )
    return segments


def parse_band_cell(paras, warnings, label):
    """(4)란 한 칸에서 업무와 주석을 뽑는다. 첫 문단(범위)은 호출 전에 뺀다."""
    services, band_notes = [], []
    blank_since_service = False
    for text, flags in paras:
        if not text.strip():
            if services:
                blank_since_service = True
            continue
        for seg in paragraph_segments(text, flags):
            name = clean_name(seg["name"])
            if not name:
                # 주석만 있는 줄: 업무 바로 아래면 그 업무의 주석, 빈 줄 뒤면 대역 주석
                if services and not blank_since_service:
                    services[-1]["notes"].extend(seg["notes"])
                else:
                    band_notes.extend(seg["notes"])
                continue
            joins_previous = name.startswith("(") or name.startswith("위성(")
            if joins_previous and services and not blank_since_service:
                # "이동위성" 다음 줄의 "(우주대지구)", "표준주파수 및 시보" 다음 줄의
                # "위성(지구대우주)"처럼 칸 폭 때문에 줄이 바뀐 업무 이름
                services[-1]["name"] = clean_name(services[-1]["name"] + name)
                services[-1]["notes"].extend(seg["notes"])
                continue
            if band_notes:
                warnings.append(f"{label}: 대역 주석 뒤에 업무가 다시 나옴 ({name!r})")
            ul = sum(seg["flags"])
            if 0 < ul < len(seg["flags"]):
                warnings.append(f"{label}: 밑줄이 업무 이름 일부에만 있음 ({name!r})")
            services.append(
                {"name": name, "primary": is_primary(seg["flags"]), "notes": seg["notes"]}
            )
            blank_since_service = False
    return services, band_notes


# 칸 폭 때문에 낱말 중간에서 줄이 바뀐 용도. 앞 줄 끝과 뒷 줄 시작으로 찾아 붙여 쓴다.
USES_WORD_BREAKS = [("무선표지 및 위치", "측정용")]
# 주석 번호가 앞 글자에 붙어 있으면("실험국용)K30") 띄운다.
GLUED_NOTE_RE = re.compile(r"(?<=[가-힣)])(?=K\d{1,3}[A-Z]{0,2}(?![\dA-Za-z]))")


def parse_uses_cell(paras):
    """(5)란 한 칸을 (용도 줄 목록, 칸 아래쪽에 따로 적힌 주석)으로 만든다.

    칸 폭 때문에 끊긴 줄은 잇는다. 주석만 있는 줄은 (4)란과 같은 규칙으로 나눈다.
    용도 바로 아래면 그 용도의 주석이고, 빈 줄 뒤에 따로 있으면 어느 용도의 것인지
    원문만으로 알 수 없으므로 용도 줄에 붙이지 않고 따로 모은다.
    """
    lines, loose_notes = [], []
    prev_raw = ""
    blank_since_line = False
    for text, _ in paras:
        s = clean_name(text)
        if not s:
            if lines:
                blank_since_line = True
            continue
        if NOTES_ONLY_RE.match(s):
            if lines and not blank_since_line and not loose_notes:
                lines[-1] = f"{lines[-1]} {s}"
            else:
                loose_notes.extend(NOTE_RE.findall(s))
            continue
        if lines and not blank_since_line:
            prev = lines[-1]
            unbalanced = prev.count("(") > prev.count(")")
            word_break = any(prev.endswith(a) and s.startswith(b) for a, b in USES_WORD_BREAKS)
            spaced = prev_raw != prev_raw.rstrip() or text != text.lstrip()
            if unbalanced or word_break or s.startswith("("):
                # 괄호 안이나 낱말 중간에서 끊긴 줄: 원문에 공백이 있을 때만 띄운다
                glue = " " if spaced and not word_break and not s.startswith("(") else ""
                lines[-1] = clean_name(prev + glue + s)
                prev_raw = text
                continue
            if prev.endswith((",", "및", "또는", "‧", "·")) or s.startswith(("및 ", "등의 ", "또는 ")):
                lines[-1] = clean_name(prev + " " + s)
                prev_raw = text
                continue
        lines.append(s)
        prev_raw = text
        blank_since_line = False
    lines = [GLUED_NOTE_RE.sub(" ", line) for line in lines]
    return lines, loose_notes


def to_hz(number: str, unit: str) -> int:
    value = Decimal(number.replace(",", "")) * UNIT_HZ[unit]
    if value != value.to_integral_value():
        raise ValueError(f"Hz 단위로 떨어지지 않는 값: {number} {unit}")
    return int(value)


def parse_table(tbl, unit, underlined, warnings):
    cells = table_cells(tbl, underlined)
    col4 = next(
        (c["col"] for c in cells if any(t.strip() == "(4)" for t, _ in c["paras"])),
        None,
    )
    if col4 is None:
        return None  # 분배표가 아닌 표(주석 안의 표 등)
    header_rows = max(
        c["row"] for c in cells if any(t.strip() == "(5)" for t, _ in c["paras"])
    ) + 1  # (1)~(5) 다음 줄이 "제 1 지역 … 용도 등" 제목 줄이다

    korea = [c for c in cells if c["col"] >= col4 and c["row"] > header_rows]
    bands = []
    for cell in korea:
        if not cell["paras"]:
            continue
        m = RANGE_RE.match(cell["paras"][0][0])
        if not m:
            continue
        lo_text, hi_text = m.group(1), m.group(2)
        label = f"{lo_text}-{hi_text} {unit}"
        corrected_from = None
        if label in CORRECTIONS:
            corrected_from = label
            lo_text, hi_text = CORRECTIONS[label]["range"]
            label = f"{lo_text}-{hi_text} {unit}"
        services, notes = parse_band_cell(cell["paras"][1:], warnings, label)
        # 용도 칸은 대역 칸과 줄 범위가 겹치는 오른쪽 칸이다. 용도 칸 하나가 여러
        # 대역에 걸쳐 병합된 곳(예: 9800-10000 ㎒의 UWB용)은 걸친 대역 모두에 적용한다.
        top, bottom = cell["row"], cell["row"] + cell["rowspan"]
        uses_cells = sorted(
            (
                c
                for c in korea
                if c["col"] > cell["col"]
                and c["row"] < bottom
                and c["row"] + c["rowspan"] > top
                and not (c["paras"] and RANGE_RE.match(c["paras"][0][0]))
            ),
            key=lambda c: (c["row"], c["col"]),
        )
        uses, uses_notes = [], []
        for uc in uses_cells:
            cell_lines, cell_notes = parse_uses_cell(uc["paras"])
            uses.extend(cell_lines)
            uses_notes.extend(n for n in cell_notes if n not in uses_notes)
        if not services:
            warnings.append(f"{label}: 업무가 없음")
        if label in BAND_NOTE_OVERRIDES:
            for note_id in BAND_NOTE_OVERRIDES[label]["notes"]:
                owners = [s for s in services if note_id in s["notes"]]
                if not owners:
                    warnings.append(f"{label}: 옮길 주석 {note_id}이(가) 업무에 없음")
                for s in owners:
                    s["notes"].remove(note_id)
                if note_id not in notes:
                    notes.append(note_id)
        band = {
            "lo": to_hz(lo_text, unit),
            "hi": to_hz(hi_text, unit),
            "label": label,
            "services": services,
            "notes": notes,
            "uses": uses,
            "usesNotes": uses_notes,
        }
        if corrected_from:
            band["correctedFrom"] = corrected_from
        bands.append(band)

    # 범위로 시작하지 않는데 글자가 있는 (4)란 칸은 놓친 내용일 수 있다
    band_rows = set()
    for c in korea:
        if c["paras"] and RANGE_RE.match(c["paras"][0][0]):
            band_rows.update(range(c["row"], c["row"] + c["rowspan"]))
    for cell in korea:
        has_text = any(t.strip() for t, _ in cell["paras"])
        first = next((t.strip() for t, _ in cell["paras"] if t.strip()), "")
        if first.startswith(UNALLOCATED_BELOW[0] + "이하"):
            continue
        if has_text and cell["row"] not in band_rows:
            sample = " / ".join(t.strip() for t, _ in cell["paras"] if t.strip())[:60]
            warnings.append(f"{unit} 표: 대역에 연결되지 않은 칸 ({sample!r})")
    return bands


def build(source: Path = SOURCE):
    warnings = []
    bands = []
    tables = 0
    with zipfile.ZipFile(source) as z:
        underlined = underlined_char_styles(z.read("Contents/header.xml"))
        sections = sorted(
            (n for n in z.namelist() if re.fullmatch(r"Contents/section\d+\.xml", n)),
            key=lambda n: int(re.search(r"\d+", n).group()),
        )
        for name in sections:
            unit = None
            for p in ET.fromstring(z.read(name)):
                if local(p.tag) != "p":
                    continue
                heading, _ = paragraph_chars(p, underlined, skip_tables=True)
                m = HEADING_RE.search(heading)
                if m:
                    unit = m.group(3)
                for tbl in (e for e in p.iter() if local(e.tag) == "tbl"):
                    parsed = parse_table(tbl, unit, underlined, warnings)
                    if parsed is None:
                        continue
                    tables += 1
                    bands.extend(parsed)
    bands.sort(key=lambda b: (b["lo"], b["hi"]))
    unify_service_spelling(bands)
    source = dict(SOURCE_INFO)
    source["corrections"] = [
        {"original": original, "corrected": b["label"], "reason": CORRECTIONS[original]["reason"]}
        for b in bands
        if (original := b.get("correctedFrom"))
    ]
    source["noteMoves"] = [
        {"band": label, "notes": o["notes"], "reason": o["reason"]}
        for label, o in BAND_NOTE_OVERRIDES.items()
    ]
    data = {
        "source": source,
        "unallocatedBelow": to_hz(*UNALLOCATED_BELOW),
        "bands": bands,
    }
    return data, warnings, tables


def unify_service_spelling(bands):
    """띄어쓰기만 다른 업무 이름("이동(항공이동제외)" 등)을 가장 흔한 표기로 맞춘다."""
    spellings = {}
    for b in bands:
        for s in b["services"]:
            key = re.sub(r"\s+", "", s["name"])
            counts = spellings.setdefault(key, {})
            counts[s["name"]] = counts.get(s["name"], 0) + 1
    canonical = {
        key: min(counts, key=lambda n: (-counts[n], len(n), n))
        for key, counts in spellings.items()
    }
    for b in bands:
        for s in b["services"]:
            s["name"] = canonical[re.sub(r"\s+", "", s["name"])]


# 번호만 있는 줄. 뒤에 "삭 제", "(WRC-12 삭제)", "미사용"이 붙으면 본문 없는 주석이다.
NOTE_ID_LINE_RE = re.compile(
    rf"^\s*((?:{NOTE_RE.pattern}\s*)+)(삭\s*제|\(WRC-\d+\s*삭제\)+|미사용)?\s*$"
)
# "5.208B 이 규정은 이전에 제5.347A호였으나 …"처럼 번호 줄에 편집 주가 붙은 주석
NOTE_RENUMBERED_RE = re.compile(rf"^\s*({NOTE_RE.pattern})\s+(이 규정은 이전에 .+)$")
FOOTNOTE_HEADINGS = ("국제 주파수 분배표 주석", "국내 주파수 분배표 주석")


def build_footnotes(source: Path = SOURCE):
    """분배표 뒤의 주석 본문을 {주석 번호: 본문}으로 모은다.

    주석은 번호만 적힌 문단 다음에 본문 문단이 이어지는 형태다. "K1 K2 삭 제"처럼
    번호 여러 개가 한 줄에 있으면 모두 삭제된 주석이다. 주석 안의 표는 옮기지 않는다.
    """
    notes = {}
    with zipfile.ZipFile(source) as z:
        sections = sorted(
            (n for n in z.namelist() if re.fullmatch(r"Contents/section\d+\.xml", n)),
            key=lambda n: int(re.search(r"\d+", n).group()),
        )
        started = False
        current = []
        for name in sections:
            for p in ET.fromstring(z.read(name)):
                if local(p.tag) != "p":
                    continue
                text, _ = paragraph_chars(p, set(), skip_tables=True)
                text = clean_name(text)
                if len(text) < 30 and text.endswith(FOOTNOTE_HEADINGS):
                    started = True
                    current = []
                    continue
                if not started or not text:
                    continue
                m = NOTE_ID_LINE_RE.match(text)
                if m:
                    current = NOTE_RE.findall(m.group(1))
                    for note_id in current:
                        status = re.sub(r"\s+", "", m.group(2) or "").strip("()")
                        notes[note_id] = status.replace("삭제", " 삭제").strip()
                    continue
                m = NOTE_RENUMBERED_RE.match(text)
                if m:
                    current = [m.group(1)]
                    notes[m.group(1)] = m.group(2)
                    continue
                if text.startswith("※"):
                    current = []
                    continue
                for note_id in current:
                    notes[note_id] = (notes[note_id] + "\n" + text).strip()
    return notes


def check_continuity(bands):
    problems = []
    for prev, cur in zip(bands, bands[1:]):
        if cur["lo"] != prev["hi"]:
            kind = "겹침" if cur["lo"] < prev["hi"] else "빈 구간"
            problems.append(f"{kind}: {prev['label']} → {cur['label']}")
    for b in bands:
        if b["hi"] <= b["lo"]:
            problems.append(f"범위가 뒤집힘: {b['label']}")
    return problems


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    data, warnings, tables = build()
    bands = data["bands"]
    problems = check_continuity(bands)

    print(f"표 {tables}개, 대역 {len(bands)}개")
    print(f"범위: {bands[0]['label']} ~ {bands[-1]['label']}")
    if "--report" in argv:
        names = {}
        for b in bands:
            for s in b["services"]:
                key = (s["name"], s["primary"])
                names[key] = names.get(key, 0) + 1
        print(f"\n업무 이름 {len({n for n, _ in names})}종 (이름, 순위, 횟수):")
        for (name, primary), count in sorted(names.items()):
            print(f"  {name} | {'1순위' if primary else '2순위'} | {count}")
    if warnings:
        print(f"\n확인 필요 {len(warnings)}건:")
        for w in warnings:
            print("  " + w)
    if problems:
        print(f"\n연속성 오류 {len(problems)}건:")
        for p in problems:
            print("  " + p)
        return 1

    footnotes = build_footnotes()
    used = {n for b in bands for n in b["notes"]}
    used |= {n for b in bands for s in b["services"] for n in s["notes"]}
    used |= {n for b in bands for line in b["uses"] for n in NOTE_RE.findall(line)}
    used |= {n for b in bands for n in b["usesNotes"]}
    missing = sorted(used - footnotes.keys())
    empty = sorted(n for n in used if footnotes.get(n) == "")
    print(f"주석 {len(footnotes)}개 (분배표에서 쓰인 것 {len(used)}개)")
    if missing:
        print(f"  본문을 찾지 못한 주석 {len(missing)}개: {' '.join(missing)}")
    if empty:
        print(f"  본문이 빈 주석 {len(empty)}개: {' '.join(empty)}")

    OUTPUT.write_text(
        json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    FOOTNOTES_OUTPUT.write_text(
        json.dumps({"source": SOURCE_INFO, "notes": footnotes}, ensure_ascii=False, indent=1)
        + "\n",
        encoding="utf-8",
    )
    print(f"\n저장: {OUTPUT.relative_to(ROOT)}, {FOOTNOTES_OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
