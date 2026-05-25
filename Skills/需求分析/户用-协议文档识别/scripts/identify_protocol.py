#!/usr/bin/env python3
import argparse
import json
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

CAN_ID_RE = re.compile(r"0x[0-9A-Fa-f]{2,8}")
MODBUS_REG_RE = re.compile(r"\b[34]\d{3,5}\b")


def canonical_vendor(token: str) -> str:
    token = token.replace("_", " ").replace("\u00A0", " ").strip()
    token = re.sub(r"\s+", " ", token)
    token = re.split(r"\s+(?:CAN|RS485|RS232|UART|MODBUS|EMS|BMS)\b", token, maxsplit=1, flags=re.IGNORECASE)[0]
    token = re.sub(r"\bV(?:ERSION)?\s*[0-9]+(?:\.[0-9A-Za-z]+){0,4}\b", "", token, flags=re.IGNORECASE)
    token = re.sub(r"\s+", " ", token).strip(" -_")
    return token


def extract_name_features(path: Path):
    stem = path.stem.upper()
    protocol_types = []
    for k in ["CAN", "RS485", "RS232", "UART", "MODBUS", "EMS", "BMS"]:
        if k in stem:
            protocol_types.append(k)
    m = re.match(r"^([A-Z]?\d{2,3})[-_ ]+(.+)$", path.stem)
    serial = m.group(1) if m else ""
    vendor = m.group(2) if m else path.stem
    vendor = canonical_vendor(vendor)
    return serial, vendor.upper(), sorted(set(protocol_types))


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


def parse_input_text(path: Path):
    text = ""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        text = read_pdf_text(path)
    elif suffix == ".docx":
        text = read_docx_text(path)
    elif suffix == ".xlsx":
        text = read_xlsx_text(path)
    else:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            text = ""
    can_ids = sorted(set(x.upper() for x in CAN_ID_RE.findall(text)))
    regs = sorted(set(MODBUS_REG_RE.findall(text)))
    return can_ids, regs


def jaccard(a, b):
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def score_doc(target, cand):
    score = 0.0
    if target["vendor"] and cand.get("vendor", "").upper() == target["vendor"]:
        score += 0.35
    if target["serial"] and cand.get("serial", "").upper() == target["serial"]:
        score += 0.10

    tp = set(target["protocol_types"])
    cp = set(cand.get("protocol_types", []))
    if tp or cp:
        score += 0.20 * (len(tp & cp) / max(1, len(tp | cp)))

    score += 0.20 * jaccard(target["can_ids"], cand.get("can_ids", []))
    score += 0.15 * jaccard(target["modbus_registers"], cand.get("modbus_registers", []))
    return round(score, 4)


def build_diff_items(target, best_cand):
    if not best_cand:
        return ["未找到可对比历史协议，建议按新协议流程立项。"]

    diffs = []
    if target.get("vendor") != (best_cand.get("vendor") or "").upper():
        diffs.append(f"厂家不一致：输入={target.get('vendor')}，参考={best_cand.get('vendor')}")

    t_types = set(target.get("protocol_types", []))
    c_types = set(best_cand.get("protocol_types", []))
    if t_types != c_types:
        only_t = sorted(t_types - c_types)
        only_c = sorted(c_types - t_types)
        if only_t:
            diffs.append(f"协议类型新增：{', '.join(only_t)}")
        if only_c:
            diffs.append(f"协议类型缺失：{', '.join(only_c)}")

    t_can = set(target.get("can_ids", []))
    c_can = set(best_cand.get("can_ids", []))
    add_can = sorted(t_can - c_can)[:10]
    miss_can = sorted(c_can - t_can)[:10]
    if add_can:
        diffs.append("新增CAN ID（最多10项）: " + ", ".join(add_can))
    if miss_can:
        diffs.append("缺失CAN ID（最多10项）: " + ", ".join(miss_can))

    t_reg = set(target.get("modbus_registers", []))
    c_reg = set(best_cand.get("modbus_registers", []))
    add_reg = sorted(t_reg - c_reg)[:10]
    miss_reg = sorted(c_reg - t_reg)[:10]
    if add_reg:
        diffs.append("新增寄存器（最多10项）: " + ", ".join(add_reg))
    if miss_reg:
        diffs.append("缺失寄存器（最多10项）: " + ", ".join(miss_reg))

    if not diffs:
        diffs.append("关键特征基本一致，可直接按旧协议复用并做小版本比对。")
    return diffs


def render_fixed_report(result):
    lines = []
    lines.append("# 协议识别报告")
    lines.append("")
    lines.append(f"- 输入文档: {result['input_doc']}")
    lines.append(f"- 判定结论: {result['verdict']}")
    lines.append(f"- 最高相似度: {result['best_score']}")
    lines.append("")
    lines.append("## 差异点清单")
    lines.append("")
    for i, item in enumerate(result["diff_items"], 1):
        lines.append(f"{i}. {item}")
    lines.append("")
    lines.append("## 推荐参考协议Top3")
    lines.append("")
    top3 = result.get("top_matches", [])[:3]
    if not top3:
        lines.append("1. 无可用参考协议")
    else:
        for i, m in enumerate(top3, 1):
            ptypes = ",".join(m.get("protocol_types") or [])
            vers = ",".join(m.get("version_tags") or [])
            lines.append(f"{i}. 路径: {m.get('path')} | 相似度: {m.get('score')} | 厂家: {m.get('vendor')} | 类型: {ptypes} | 版本: {vers}")
    lines.append("")
    lines.append("## 后续编写建议")
    lines.append("")
    if top3:
        lines.append("1. 先以Top1协议为主骨架进行收发帧和字段映射。")
        lines.append("2. 依据差异点清单逐项补齐新增帧/寄存器并标注变更点。")
        lines.append("3. 保留Top2/Top3用于边界字段与异常码对照验证。")
    else:
        lines.append("1. 按新协议流程新建实现，先固化报文与寄存器字典。")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="识别协议文档新旧")
    parser.add_argument("--doc", required=True, help="待识别文档路径")
    parser.add_argument(
        "--kb",
        default=str(Path(__file__).resolve().parents[1] / "references" / "protocol_kb.json"),
        help="知识库 json 路径",
    )
    parser.add_argument("--topk", type=int, default=5, help="输出前 k 项")
    parser.add_argument("--json-only", action="store_true", help="仅输出 JSON")
    args = parser.parse_args()

    doc = Path(args.doc).resolve()
    kb_path = Path(args.kb).resolve()
    kb = json.loads(kb_path.read_text(encoding="utf-8"))

    serial, vendor, ptypes = extract_name_features(doc)
    can_ids, regs = parse_input_text(doc)
    target = {
        "serial": serial,
        "vendor": vendor,
        "protocol_types": ptypes,
        "can_ids": can_ids,
        "modbus_registers": regs,
    }

    scored = []
    for cand in kb.get("documents", []):
        s = score_doc(target, cand)
        scored.append((s, cand))
    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[0][0] if scored else 0.0

    if best >= 0.78:
        verdict = "旧协议分支"
    elif best < 0.55:
        verdict = "新协议"
    else:
        verdict = "待人工确认"

    top_matches = [
        {
            "score": s,
            "path": c.get("rel_path"),
            "vendor": c.get("vendor"),
            "protocol_types": c.get("protocol_types"),
            "version_tags": c.get("version_tags"),
            "can_ids": c.get("can_ids") or [],
            "modbus_registers": c.get("modbus_registers") or [],
        }
        for s, c in scored[: args.topk]
    ]

    best_cand = top_matches[0] if top_matches else None
    diff_items = build_diff_items(target, best_cand)

    result = {
        "input_doc": doc.as_posix(),
        "verdict": verdict,
        "best_score": best,
        "top_matches": top_matches,
        "target_features": target,
        "diff_items": diff_items,
    }

    if args.json_only:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_fixed_report(result))


if __name__ == "__main__":
    main()
