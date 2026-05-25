import pytest

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
