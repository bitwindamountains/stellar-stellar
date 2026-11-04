import pytest

from postpilot.models import Account, Post
from postpilot.validation import validate, x_length

ACCOUNTS = {
    "main": Account("main", "PAGE1", "IG1", "META_TOKEN_MAIN", "Asia/Manila"),
    "fbonly": Account("fbonly", "PAGE2", "", "META_TOKEN_FB", "Asia/Manila"),
}


def errors(**cells):
    base = {"account": "main", "publish_at": "2026-10-05 18:00", "caption": "Hi"}
    return validate(Post(row=2, cells={**base, **cells}), ACCOUNTS)


def test_valid_fb_text_post():
    assert errors(platforms="facebook") == []


def test_valid_ig_image_post():
    assert errors(platforms="instagram", media_type="image", media_urls="https://x/a.jpg") == []


def test_valid_assisted_video_post():
    assert errors(platforms="tiktok,youtube", media_type="video", media_urls="https://x/a.mp4") == []


@pytest.mark.parametrize(
    ("cells", "expected"),
    [
        ({"account": "nope", "platforms": "facebook"}, "Unknown account 'nope'"),
        ({"platforms": ""}, "Pick at least one platform"),
        ({"platforms": "facebook,myspace"}, "Unknown platform 'myspace'"),
        (
            {
                "account": "fbonly",
                "platforms": "instagram",
                "media_type": "image",
                "media_urls": "https://x/a.jpg",
            },
            "no ig_user_id",
        ),
        ({"platforms": "facebook", "publish_at": "soon"}, "publish_at must look like"),
        ({"platforms": "instagram"}, "Instagram needs an image"),
        ({"platforms": "facebook", "media_type": "gif"}, "media_type must be one of"),
        ({"platforms": "facebook", "media_type": "image"}, "media_urls is empty"),
        ({"platforms": "facebook", "media_urls": "https://x/a.jpg"}, "set media_type"),
        (
            {"platforms": "facebook", "media_type": "image", "media_urls": "http://x/a.jpg"},
            "must start with https://",
        ),
        (
            {
                "platforms": "facebook",
                "media_type": "image",
                "media_urls": "https://x/a.jpg\nhttps://x/b.jpg",
            },
            "one media file per post",
        ),
        ({"platforms": "tiktok"}, "TikTok/YouTube need a video"),
        (
            {
                "platforms": "facebook",
                "media_type": "image",
                "media_urls": "https://drive.google.com/file/d/X/view",
            },
            "Google Drive",
        ),
        ({"platforms": "facebook", "caption": ""}, "Facebook post is empty"),
        (
            {
                "platforms": "instagram",
                "media_type": "image",
                "media_urls": "https://x/a.jpg",
                "caption": "x" * 2201,
            },
            "2,200",
        ),
        (
            {
                "platforms": "instagram",
                "media_type": "image",
                "media_urls": "https://x/a.jpg",
                "caption": " ".join(f"#t{i}" for i in range(31)),
            },
            "30 hashtags",
        ),
    ],
)
def test_rule(cells, expected):
    found = errors(**cells)
    assert any(expected in e for e in found), found


def test_bad_timezone_reported_once():
    accounts = {"tz": Account("tz", "P", "", "T", "Mars/Base")}
    post = Post(
        row=2,
        cells={"account": "tz", "platforms": "facebook", "publish_at": "2026-10-05 18:00", "caption": "x"},
    )
    assert validate(post, accounts) == ["Unknown time zone 'Mars/Base' in Accounts tab"]


LINKED = {
    "linked": Account("linked", "PAGE3", "IG3", "", "Asia/Manila", frozenset({"meta", "x", "tiktok"})),
}


def linked_errors(**cells):
    base = {"account": "linked", "publish_at": "2026-10-05 18:00", "caption": "Hi"}
    return validate(Post(row=2, cells={**base, **cells}), LINKED)


def test_meta_connection_replaces_token_env():
    assert linked_errors(platforms="facebook") == []


def test_x_needs_a_connection():
    assert any("connect X" in e for e in errors(platforms="x"))
    assert linked_errors(platforms="x") == []


@pytest.mark.parametrize(
    ("text", "length"),
    [
        ("hello", 5),
        ("see https://example.com/a/very/long/path?q=1", 4 + 23),
        ("日本", 4),
        ("ok 👍", 5),
        ("é", 1),
        ("\U0001f44d\U0001f3fd", 2),  # thumbs up, skin tone
        ("\U0001f468‍\U0001f469‍\U0001f467", 2),  # family (joined emoji)
        ("\U0001f1f5\U0001f1ed", 2),  # flag
        ("❤️", 2),  # red heart: the variation selector adds nothing
        ("visit shop.example.com today", 6 + 23 + 6),
        ("e.g. this", 9),
    ],
)
def test_x_length_is_weighted_like_x(text, length):
    assert x_length(text) == length


def test_x_limits():
    assert any("280" in e for e in linked_errors(platforms="x", caption="a" * 281))
    assert linked_errors(platforms="x", caption="a" * 280) == []
    assert any("280" in e for e in linked_errors(platforms="x", caption="字" * 141))


def test_x_counts_the_link():
    found = linked_errors(platforms="x", caption="a" * 260, link="https://example.com")
    assert any("280" in e for e in found)


def test_connected_tiktok_caption_limit():
    video = {"platforms": "tiktok", "media_type": "video", "media_urls": "https://x/a.mp4"}
    assert linked_errors(**video) == []
    assert any("2,200" in e for e in linked_errors(**video, caption="x" * 2201))


def test_shopee_is_by_hand_and_needs_no_media():
    assert errors(platforms="shopee") == []
    assert any("shopee" in e for e in errors(platforms="shopee", caption="x" * 4100))


IG_IMG = {"platforms": "instagram", "media_type": "image", "media_urls": "https://x/a.jpg"}


def test_first_comment_instagram_limit_counts_utf16_units():
    msg = "First comment: Instagram allows at most 2,200 characters"
    assert msg not in errors(**IG_IMG, first_comment="x" * 2200)
    assert msg in errors(**IG_IMG, first_comment="x" * 2201)
    assert msg not in errors(**IG_IMG, first_comment="😀" * 1100)  # 2,200 units
    assert msg in errors(**IG_IMG, first_comment="😀" * 1100 + "x")  # 2,201 units (1,101 code points)


def test_first_comment_ok_and_empty_add_no_errors():
    assert errors(**IG_IMG, first_comment="") == []
    assert errors(**IG_IMG, first_comment="BUY #a #b #c #d #e https://a.co https://b.co") == []
    assert errors(platforms="facebook", first_comment="x" * 3000) == []  # IG rule only applies to IG


def test_first_comment_too_long_for_phone_handoff():
    video = {"media_type": "video", "media_urls": "https://x/a.mp4"}
    msg = "First comment too long for the phone handoff"
    assert msg in errors(platforms="youtube", first_comment="x" * 4037, **video)
    assert msg not in errors(platforms="youtube", first_comment="x" * 4036, **video)
    assert msg not in errors(platforms="facebook", first_comment="x" * 5000)
    # TikTok drafts get the comment block in Telegram too, even when TikTok is connected.
    tiktok = {"platforms": "tiktok", **video}
    assert msg in linked_errors(**tiktok, first_comment="x" * 4037)
    assert msg not in linked_errors(**tiktok, first_comment="x" * 4036)
    assert msg in errors(account="nobody", **tiktok, first_comment="x" * 4037)


VIDEO = {"media_type": "video", "media_urls": "https://x/a.mp4"}


def test_video_allowed_to_facebook_instagram_x():
    got = linked_errors(platforms="facebook,instagram,x", **VIDEO)
    assert got == []


def test_instagram_jpeg_rule_only_for_images():
    assert not any("JPEG" in e for e in errors(platforms="instagram", **VIDEO))
    png = errors(platforms="instagram", media_type="image", media_urls="https://x/a.png")
    assert any("JPEG" in e for e in png)


def test_cover_needs_video_https_and_jpeg():
    video = {"platforms": "instagram", **VIDEO}
    img = errors(
        platforms="instagram", media_type="image", media_urls="https://x/a.jpg", cover_url="https://x/c.jpg"
    )
    assert "A cover is only for videos" in img
    assert any("https://" in e for e in errors(**video, cover_url="http://x/c.jpg"))
    assert "The cover must be a JPEG" in errors(**video, cover_url="https://x/c.png")
    assert errors(**video, cover_url="https://x/c.jpg") == []
