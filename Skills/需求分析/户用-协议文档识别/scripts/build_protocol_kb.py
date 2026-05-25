#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import List
import xml.etree.ElementTree as ET


TEXT_SUFFIXES = {".txt", ".md", ".csv", ".json", ".xml", ".rtf"}
DOC_SUFFIXES = {".docx"}
SHEET_SUFFIXES = {".xlsx"}
PDF_SUFFIXES = {".pdf"}
SUPPORTED_SUFFIXES = TEXT_SUFFIXES | DOC_SUFFIXES | SHEET_SUFFIXES | PDF_SUFFIXES

PROTOCOL_HINTS = [
    "CAN",
    "RS485",
    "RS232",
    "UART",
    "MODBUS",
    "MODBUS_RTU",
    "EMS",
    "BMS",
]

VERSION_RE = re.compile(r"\bV(?:ERSION)?\s*([0-9]+(?:\.[0-9A-Za-z]+){0,4})\b", re.IGNORECASE)
DATE_RE = re.compile(r"(20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2})")
CAN_ID_RE = re.compile(r"0x[0-9A-Fa-f]{2,8}")
MODBUS_REG_RE = re.compile(r"\b[34]\d{3,5}\b")


@dataclass
class DocInfo:
    rel_path: str
    source_dir: str
    ext: str
    vendor: str
    serial: str
    protocol_types: List[str]
    version_tags: List[str]
    date_tags: List[str]
    notes: List[str]
    can_ids: List[str]
    modbus_registers: List[str]
    text_excerpt: str
    fingerprint: str


def read_pdf_text(path: Path, max_chars: int = 20000) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        chunks = []
        for page in reader.pages[:5]:
            txt = page.extract_text() or ""
            if txt:
                chunks.append(txt)
            if sum(len(c) for c in chunks) >= max_chars:
                break
        return "\n".join(chunks)[:max_chars]
    except Exception:
        return ""


def read_docx_text(path: Path, max_chars: int = 20000) -> str:
    try:
        with zipfile.ZipFile(path) as zf:
            xml_bytes = zf.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        texts = [node.text for node in root.findall(".//w:t", ns) if node.text]
        return "\n".join(texts)[:max_chars]
    except Exception:
        return ""


def read_xlsx_text(path: Path, max_chars: int = 20000) -> str:
    try:
        with zipfile.ZipFile(path) as zf:
            shared = []
            if "xl/sharedStrings.xml" in zf.namelist():
                root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
                shared = [t.text or "" for t in root.findall(".//a:t", ns)]

            chunks = []
            for name in zf.namelist():
                if not name.startswith("xl/worksheets/") or not name.endswith(".xml"):
                    continue
                root = ET.fromstring(zf.read(name))
                ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
                for c in root.findall(".//a:c", ns):
                    t = c.attrib.get("t")
                    v = c.find("a:v", ns)
                    if v is None or v.text is None:
                        continue
                    if t == "s":
                        idx = int(v.text)
                        if 0 <= idx < len(shared):
                            chunks.append(shared[idx])
                    else:
                        chunks.append(v.text)
                if sum(len(x) for x in chunks) >= max_chars:
                    break
            return "\n".join(chunks)[:max_chars]
    except Exception:
        return ""


def read_plain_text(path: Path, max_chars: int = 20000) -> str:
    for enc in ("utf-8", "utf-8-sig", "gbk", "latin-1"):
        try:
            return path.read_text(encoding=enc, errors="ignore")[:max_chars]
        except Exception:
            continue
    return ""


def normalize_name_token(token: str) -> str:
    token = token.replace("_", " ").replace("\u00A0", " ").strip()
    token = re.sub(r"\s+", " ", token)
    return token


def canonical_vendor(token: str) -> str:
    token = normalize_name_token(token)
    token = re.split(r"\s+(?:CAN|RS485|RS232|UART|MODBUS|EMS|BMS)\b", token, maxsplit=1, flags=re.IGNORECASE)[0]
    token = re.sub(r"\bV(?:ERSION)?\s*[0-9]+(?:\.[0-9A-Za-z]+){0,4}\b", "", token, flags=re.IGNORECASE)
    token = re.sub(r"\s+", " ", token).strip(" -_")
    return token


def parse_filename_features(path: Path):
    stem = path.stem
    notes = re.findall(r"[（(]([^）)]+)[）)]", stem)
    serial = ""
    vendor = ""

    m = re.match(r"^([A-Za-z]?\d{2,3}|[A-Za-z]\d{2,3})[-_ ]+", stem)
    if m:
        serial = m.group(1)
        rest = stem[m.end() :]
    else:
        rest = stem

    vendor_part = re.split(r"\s+(?:CAN|RS485|RS232|UART|MODBUS|Modbus|CAN_RS485)\b", rest, maxsplit=1, flags=re.IGNORECASE)[0]
    vendor = canonical_vendor(vendor_part)[:80]
    return serial, vendor, notes


def collect_protocol_types(*texts: str) -> List[str]:
    full = " ".join(t.upper() for t in texts if t)
    types = []
    for hint in PROTOCOL_HINTS:
        if hint in full:
            types.append(hint)
    return sorted(set(types))


def build_one(path: Path, project_root: Path) -> DocInfo:
    suffix = path.suffix.lower()
    serial, vendor, notes = parse_filename_features(path)
    source_dir = path.parent.name

    text = ""
    if suffix in PDF_SUFFIXES:
        text = read_pdf_text(path)
    elif suffix in DOC_SUFFIXES:
        text = read_docx_text(path)
    elif suffix in SHEET_SUFFIXES:
        text = read_xlsx_text(path)
    elif suffix in TEXT_SUFFIXES:
        text = read_plain_text(path)

    title_text = path.stem
    protocol_types = collect_protocol_types(title_text, text)
    versions = sorted(set(VERSION_RE.findall(title_text + "\n" + text)))
    dates = sorted(set(DATE_RE.findall(title_text + "\n" + text)))
    can_ids = sorted(set(x.upper() for x in CAN_ID_RE.findall(text)))[:120]
    registers = sorted(set(MODBUS_REG_RE.findall(text)))[:120]
    excerpt = re.sub(r"\s+", " ", text).strip()[:500]

    fp_source = "|".join(
        [
            vendor.upper(),
            ",".join(protocol_types),
            ",".join(versions),
            ",".join(can_ids[:30]),
            ",".join(registers[:30]),
            serial,
        ]
    )
    fp = hashlib.sha1(fp_source.encode("utf-8")).hexdigest()

    return DocInfo(
        rel_path=path.relative_to(project_root).as_posix(),
        source_dir=source_dir,
        ext=suffix,
        vendor=vendor,
        serial=serial,
        protocol_types=protocol_types,
        version_tags=versions,
        date_tags=dates,
        notes=notes,
        can_ids=can_ids,
        modbus_registers=registers,
        text_excerpt=excerpt,
        fingerprint=fp,
    )


def main():
    parser = argparse.ArgumentParser(description="构建协议文档知识库")
    parser.add_argument("--project-root", required=True, help="项目根目录")
    parser.add_argument("--doc-dirs", nargs="*", default=["485_doc", "can_doc"], help="文档目录名")
    parser.add_argument("--out-json", default=None, help="输出 json")
    parser.add_argument("--out-md", default=None, help="输出 markdown")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    skill_root = Path(__file__).resolve().parents[1]
    out_json = Path(args.out_json) if args.out_json else skill_root / "references" / "protocol_kb.json"
    out_md = Path(args.out_md) if args.out_md else skill_root / "references" / "protocol_summary.md"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_md.parent.mkdir(parents=True, exist_ok=True)

    files = []
    for d in args.doc_dirs:
        base = project_root / d
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            if p.name.startswith("~$"):
                continue
            if p.suffix.lower() in SUPPORTED_SUFFIXES:
                files.append(p)
            else:
                # 未解析类型也保留记录
                files.append(p)

    docs = []
    unsupported = []
    for p in sorted(files):
        if p.suffix.lower() not in SUPPORTED_SUFFIXES:
            unsupported.append(p.relative_to(project_root).as_posix())
            continue
        docs.append(build_one(p, project_root))

    by_vendor = {}
    for d in docs:
        key = d.vendor or "UNKNOWN"
        by_vendor[key] = by_vendor.get(key, 0) + 1

    kb = {
        "project_root": project_root.as_posix(),
        "doc_dirs": args.doc_dirs,
        "stats": {
            "total_supported_docs": len(docs),
            "unsupported_docs": len(unsupported),
            "vendor_count": len(by_vendor),
        },
        "vendors_top": sorted(by_vendor.items(), key=lambda x: (-x[1], x[0]))[:100],
        "unsupported_files": unsupported,
        "documents": [d.__dict__ for d in docs],
    }

    out_json.write_text(json.dumps(kb, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = []
    lines.append("# 协议文档知识库摘要")
    lines.append("")
    lines.append(f"- 项目根目录: {project_root.as_posix()}")
    lines.append(f"- 可解析文档数: {len(docs)}")
    lines.append(f"- 未纳入解析的文件数: {len(unsupported)}")
    lines.append(f"- 厂家条目数: {len(by_vendor)}")
    lines.append("")
    lines.append("## 厂家文档数量 Top 30")
    lines.append("")
    for vendor, count in sorted(by_vendor.items(), key=lambda x: (-x[1], x[0]))[:30]:
        lines.append(f"- {vendor}: {count}")
    lines.append("")
    lines.append("## 判定参考规则")
    lines.append("")
    lines.append("- 优先比较: 厂家 + 协议类型 + 版本线")
    lines.append("- CAN文档再比较: CAN ID集合交集比例")
    lines.append("- 485文档再比较: Modbus寄存器集合交集比例")
    lines.append("- 若正文不可解析，退化到文件名特征判定")
    lines.append("")
    lines.append("## 说明")
    lines.append("")
    lines.append("- 本摘要由脚本自动生成，可重复执行覆盖更新。")
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"[OK] 写入 {out_json}")
    print(f"[OK] 写入 {out_md}")
    print(f"[OK] 支持解析 {len(docs)} 个文档，未解析类型 {len(unsupported)} 个")


if __name__ == "__main__":
    main()
