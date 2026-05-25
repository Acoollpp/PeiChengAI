import re


_REVISION_PATTERN = re.compile(r"^[rR]?(\d+)$")


def normalize_revision(value: str) -> str:
    normalized = value.strip()
    match = _REVISION_PATTERN.fullmatch(normalized)
    if match is None:
        raise ValueError("版本号只允许 r数字 或 数字 格式")
    return f"r{match.group(1)}"


def validate_svn_url(value: str, allowed_prefix: str) -> str:
    normalized = value.strip()
    normalized_prefix = allowed_prefix.strip().rstrip("/") + "/"
    if not normalized.startswith(normalized_prefix):
        raise ValueError("SVN 地址不在允许范围内")
    return normalized
