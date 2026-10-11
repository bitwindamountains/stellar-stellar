from datetime import UTC, datetime

import pytest

from postpilot.models import Account, Post
from postpilot.timeutil import parse_local


def post(**cells):
    return Post(row=2, cells=cells)


def test_platforms_parsed_lowercase_deduped():
    assert post(platforms=" Facebook, instagram,facebook ,").platforms == ["facebook", "instagram"]


def test_media_urls_split_on_newlines():
    assert post(media_urls="https://a/1.jpg\n\n https://a/2.jpg ").media_urls == [
        "https://a/1.jpg",
        "https://a/2.jpg",
    ]


def test_done_uses_platform_id_columns():
    p = post(platforms="facebook,instagram,tiktok", fb_post_id="1_2")
    assert p.done("facebook")
    assert not p.done("instagram")
    assert not p.done("tiktok")


def test_assisted_platforms_done_when_telegram_sent():
    p = post(platforms="tiktok,youtube", tg_message_id="55")
    assert p.done("tiktok") and p.done("youtube")


def test_missing_cells_read_as_empty():
    assert post().get("caption") == ""


def test_account_from_cells_defaults_timezone():
    a = Account.from_cells({"account": "main", "fb_page_id": "1", "token_env": "META_TOKEN_MAIN"})
    assert a.timezone == "Asia/Manila"
    assert a.ig_user_id == ""


def test_parse_local_manila_to_utc():
    assert parse_local("2026-10-05 18:00", "Asia/Manila") == datetime(2026, 10, 5, 10, 0, tzinfo=UTC)
    assert parse_local("2026-10-05 18:00:30", "Asia/Manila").second == 30


@pytest.mark.parametrize("bad", ["", "10/05/2026 18:00", "2026-13-01 10:00", "tomorrow"])
def test_parse_local_rejects_bad_dates(bad):
    with pytest.raises(ValueError, match="publish_at"):
        parse_local(bad, "Asia/Manila")


def test_parse_local_rejects_unknown_timezone():
    with pytest.raises(ValueError, match="time zone"):
        parse_local("2026-10-05 18:00", "Mars/Base")
