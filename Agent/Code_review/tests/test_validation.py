import pytest

from app.repositories import (
    PRODUCT_REPOSITORY_KEYS,
    PUBLIC_REPOSITORY_KEYS,
    RepositoryAccessError,
    match_repository_for_url,
    repositories_for_user,
    validate_repository_keys,
)
from app.validation import normalize_revision, validate_svn_url


def test_normalize_revision_adds_lowercase_r_prefix_to_digits():
    assert normalize_revision("25576") == "r25576"


def test_normalize_revision_preserves_lowercase_revision():
    assert normalize_revision("r29303") == "r29303"


def test_normalize_revision_lowercases_uppercase_prefix():
    assert normalize_revision("R29303") == "r29303"


def test_normalize_revision_rejects_invalid_format():
    with pytest.raises(ValueError, match="版本号"):
        normalize_revision("r25x")


def test_validate_svn_url_accepts_allowed_prefix():
    url = "https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T"

    assert validate_svn_url(url, "https://192.168.0.233/svn/src_home/") == url


def test_validate_svn_url_accepts_allowed_prefix_without_trailing_slash():
    url = "https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T"

    assert validate_svn_url(url, "https://192.168.0.233/svn/src_home") == url


def test_validate_svn_url_rejects_other_hosts():
    with pytest.raises(ValueError, match="SVN"):
        validate_svn_url(
            "https://example.com/svn/src_home/PCB_1447V320/SST22-1404-T",
            "https://192.168.0.233/svn/src_home/",
        )


def test_validate_svn_url_rejects_prefix_without_path_boundary():
    with pytest.raises(ValueError, match="SVN"):
        validate_svn_url(
            "https://192.168.0.233/svn/src_home_evil/repo",
            "https://192.168.0.233/svn/src_home",
        )


def test_match_repository_for_full_product_url():
    match = match_repository_for_url(
        " https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T "
    )

    assert match.key == "home"
    assert match.name == "户储"
    assert match.url_prefix == "https://192.168.0.233/svn/src_home"


def test_match_repository_rejects_similar_prefix():
    try:
        match_repository_for_url("https://192.168.0.233/svn/src_home_other/project")
    except RepositoryAccessError as exc:
        assert str(exc) == "SVN 地址不属于已配置仓库"
    else:
        raise AssertionError("Expected RepositoryAccessError")


def test_repositories_for_user_includes_public_and_granted_products():
    repos = repositories_for_user({"home", "power"})
    keys = [repo.key for repo in repos]

    assert keys[:2] == list(PUBLIC_REPOSITORY_KEYS)
    assert "home" in keys
    assert "power" in keys
    assert "bs" not in keys
    assert set(PRODUCT_REPOSITORY_KEYS) >= {"energy", "home", "bs", "moto", "lcd", "linux", "pace_tools", "power"}


def test_match_repository_rejects_relative_path_segments():
    with pytest.raises(RepositoryAccessError, match="相对路径段"):
        match_repository_for_url("https://192.168.0.233/svn/src_home/../src_power/project")


def test_match_repository_rejects_encoded_relative_path_segments():
    with pytest.raises(RepositoryAccessError, match="相对路径段"):
        match_repository_for_url("https://192.168.0.233/svn/src_home/%2e%2e/src_power/project")


def test_validate_repository_keys_deduplicates_in_product_order():
    assert validate_repository_keys(["power", "home", "home"]) == ["home", "power"]


def test_validate_repository_keys_rejects_public_repository_keys():
    with pytest.raises(RepositoryAccessError):
        validate_repository_keys(["documents"])
