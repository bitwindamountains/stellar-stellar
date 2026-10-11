import pytest

from postpilot.models import Account, Post
from postpilot.validation import validate

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
            "one image per post",
        ),
        (
            {"platforms": "facebook", "media_type": "video", "media_urls": "https://x/a.mp4"},
            "Video to Facebook/Instagram isn't supported yet",
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
