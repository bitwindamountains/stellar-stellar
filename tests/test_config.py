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


def test_supabase_replaces_google_settings():
    cfg = load_config(
        {
            "SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "k",
            "META_GRAPH_VERSION": "v23.0",
        }
    )
    assert cfg.supabase_url == "https://x.supabase.co" and cfg.sheet_id == ""


def test_supabase_url_needs_service_key():
    with pytest.raises(ConfigError, match="SUPABASE_SERVICE_ROLE_KEY"):
        load_config({"SUPABASE_URL": "https://x.supabase.co", "META_GRAPH_VERSION": "v23.0"})


def test_web_app_url_optional():
    assert load_config(BASE).web_app_url == ""
    assert load_config({**BASE, "WEB_APP_URL": "https://pp.example/"}).web_app_url == "https://pp.example"
