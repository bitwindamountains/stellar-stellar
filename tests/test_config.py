import pytest

from postpilot.config import ConfigError, load_config

BASE = {
    "GOOGLE_SHEET_ID": "sheet",
    "GOOGLE_SERVICE_ACCOUNT_FILE": "secrets/sa.json",
    "META_GRAPH_VERSION": "v23.0",
}


def test_defaults():
    cfg = load_config(BASE)
    assert cfg.sheet_id == "sheet"
    assert cfg.late_grace_minutes == 180
    assert cfg.max_posts_per_run == 10
    assert cfg.max_attempts == 3
    assert cfg.stale_posting_minutes == 30
    assert cfg.telegram_bot_token == ""


def test_missing_lists_names_only():
    with pytest.raises(ConfigError) as e:
        load_config({"GOOGLE_SERVICE_ACCOUNT_JSON": "{secret}"})
    msg = str(e.value)
    assert "GOOGLE_SHEET_ID" in msg and "META_GRAPH_VERSION" in msg
    assert "secret" not in msg


def test_needs_a_service_account():
    env = {k: v for k, v in BASE.items() if k != "GOOGLE_SERVICE_ACCOUNT_FILE"}
    with pytest.raises(ConfigError, match="GOOGLE_SERVICE_ACCOUNT_JSON"):
        load_config(env)


def test_bad_number():
    with pytest.raises(ConfigError, match="PP_MAX_ATTEMPTS"):
        load_config({**BASE, "PP_MAX_ATTEMPTS": "three"})
