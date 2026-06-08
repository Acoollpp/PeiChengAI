from app.models import ClientRelease


def test_client_release_model_is_available() -> None:
    release = ClientRelease(
        version="1.0.1",
        platform="win32",
        arch="x64",
        release_notes="修复任务列表显示问题",
        artifact_name="代码审查-v1.0.1.exe",
        artifact_path="/tmp/release/代码审查-v1.0.1.exe",
        artifact_size=12,
        artifact_sha512="a" * 128,
        latest_yml_name="latest.yml",
        latest_yml_path="/tmp/release/latest.yml",
        is_active=False,
    )

    assert release.version == "1.0.1"
    assert release.platform == "win32"
    assert release.arch == "x64"
