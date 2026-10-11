import json

from postpilot.models import Account, Post
from postpilot.validation import validate

ACCOUNTS = {"main": Account("main", "PAGE", "IG", "T", "Asia/Manila")}


def post(variants=None, **cells):
    base = {"account": "main", "publish_at": "2026-10-05 18:00", "caption": "Base caption", **cells}
    if variants is not None:
        base["variants"] = json.dumps(variants)
    return Post(row=2, cells=base)


def test_text_falls_back_to_base_caption():
    assert post().text_for("facebook") == "Base caption"


def test_override_and_hashtags_per_platform():
    p = post(
        {"instagram": {"caption": "IG words", "hashtags": "#kape #manila"}, "tiktok": {"hashtags": "#fyp"}}
    )
    assert p.text_for("instagram") == "IG words\n\n#kape #manila"
    assert p.text_for("tiktok") == "Base caption\n\n#fyp"
    assert p.text_for("facebook") == "Base caption"


def test_blank_override_means_use_base():
    assert post({"facebook": {"caption": "  ", "hashtags": ""}}).text_for("facebook") == "Base caption"


def test_title_only_for_given_platform():
    p = post({"youtube": {"title": "Latte art in 30 seconds"}})
    assert p.title_for("youtube") == "Latte art in 30 seconds"
    assert p.title_for("tiktok") == ""


def test_bad_variants_json_is_ignored():
    assert Post(row=2, cells={"caption": "x", "variants": "{not json"}).text_for("facebook") == "x"
    assert Post(row=2, cells={"caption": "x", "variants": "[1]"}).text_for("facebook") == "x"


def test_instagram_limits_apply_to_instagram_text():
    long_tags = " ".join(f"#t{i}" for i in range(31))
    ok = post(
        {"facebook": {"hashtags": long_tags}},
        platforms="facebook,instagram",
        media_type="image",
        media_urls="https://x/a.jpg",
    )
    assert validate(ok, ACCOUNTS) == []
    bad = post(
        {"instagram": {"hashtags": long_tags}},
        platforms="facebook,instagram",
        media_type="image",
        media_urls="https://x/a.jpg",
    )
    assert any("30 hashtags" in e for e in validate(bad, ACCOUNTS))


def test_youtube_title_limit():
    p = post(
        {"youtube": {"title": "x" * 101}},
        platforms="youtube",
        media_type="video",
        media_urls="https://x/a.mp4",
    )
    assert any("YouTube title" in e for e in validate(p, ACCOUNTS))


def test_facebook_empty_uses_facebook_text():
    p = post({"facebook": {"hashtags": "#kape"}}, platforms="facebook", caption="")
    assert validate(p, ACCOUNTS) == []
