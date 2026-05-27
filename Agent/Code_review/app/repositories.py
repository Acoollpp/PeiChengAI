from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import unquote, urlsplit


class RepositoryAccessError(ValueError):
    pass


@dataclass(frozen=True)
class RepositoryDefinition:
    key: str
    name: str
    url_prefix: str
    is_public: bool


REPOSITORIES: tuple[RepositoryDefinition, ...] = (
    RepositoryDefinition("public_repository", "公共仓库", "https://192.168.0.233/svn/02_public_repository", True),
    RepositoryDefinition("documents", "文档仓库", "https://192.168.0.233/svn/documents", True),
    RepositoryDefinition("energy", "高压", "https://192.168.0.233/svn/src_energy", False),
    RepositoryDefinition("home", "户储", "https://192.168.0.233/svn/src_home", False),
    RepositoryDefinition("bs", "基站", "https://192.168.0.233/svn/src_bs", False),
    RepositoryDefinition("moto", "动力", "https://192.168.0.233/svn/src_moto", False),
    RepositoryDefinition("lcd", "显示屏", "https://192.168.0.233/svn/src_lcd", False),
    RepositoryDefinition("linux", "Linux", "https://192.168.0.233/svn/src_linux", False),
    RepositoryDefinition("pace_tools", "上位机", "https://192.168.0.233/svn/src_PaceTools", False),
    RepositoryDefinition("power", "电源", "https://192.168.0.233/svn/src_power", False),
)

REPOSITORY_BY_KEY = {repo.key: repo for repo in REPOSITORIES}
PUBLIC_REPOSITORY_KEYS = tuple(repo.key for repo in REPOSITORIES if repo.is_public)
PRODUCT_REPOSITORY_KEYS = tuple(repo.key for repo in REPOSITORIES if not repo.is_public)


def match_repository_for_url(svn_url: str) -> RepositoryDefinition:
    parsed = urlsplit(svn_url.strip())
    if parsed.scheme != "https":
        raise RepositoryAccessError("SVN 地址必须使用 HTTPS")

    for segment in parsed.path.split("/"):
        decoded_segment = unquote(segment)
        if segment in {".", ".."} or decoded_segment in {".", ".."} or "/" in decoded_segment or "\\" in decoded_segment:
            raise RepositoryAccessError("SVN 地址不允许包含相对路径段")

    normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")
    for repo in sorted(REPOSITORIES, key=lambda item: len(item.url_prefix), reverse=True):
        prefix_parts = urlsplit(repo.url_prefix)
        prefix = f"{prefix_parts.scheme}://{prefix_parts.netloc}{prefix_parts.path}".rstrip("/")
        if normalized == prefix or normalized.startswith(f"{prefix}/"):
            return repo
    raise RepositoryAccessError("SVN 地址不属于已配置仓库")


def repositories_for_user(granted_keys: set[str]) -> list[RepositoryDefinition]:
    visible = []
    for repo in REPOSITORIES:
        if repo.is_public or repo.key in granted_keys:
            visible.append(repo)
    return visible


def product_repositories() -> list[RepositoryDefinition]:
    return [repo for repo in REPOSITORIES if not repo.is_public]


def validate_repository_keys(repository_keys: list[str] | set[str]) -> list[str]:
    requested = set(repository_keys)
    unknown = sorted(requested - set(PRODUCT_REPOSITORY_KEYS))
    if unknown:
        raise RepositoryAccessError(f"未知产品仓库: {', '.join(unknown)}")
    return [key for key in PRODUCT_REPOSITORY_KEYS if key in requested]
