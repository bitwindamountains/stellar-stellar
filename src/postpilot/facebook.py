from postpilot.graph import fetch_permalink, insight
from postpilot.models import Account, Post, PublishResult


def comment(graph, post_id: str, text: str) -> str:
    # Not safe: a timeout may still have posted the comment, so it is never retried.
    return graph.post(f"{post_id}/comments", safe=False, message=text)["id"]


def publish(graph, account: Account, post: Post) -> PublishResult:
    caption, link, urls = post.text_for("facebook"), post.get("link"), post.media_urls
    if urls:
        # Photo posts have no link field, so the link goes in the caption.
        text = "\n\n".join(t for t in (caption, link) if t)
        response = graph.post(f"{account.fb_page_id}/photos", safe=False, url=urls[0], caption=text)
        post_id = response.get("post_id") or response["id"]
    else:
        fields = {"message": caption, **({"link": link} if link else {})}
        post_id = graph.post(f"{account.fb_page_id}/feed", safe=False, **fields)["id"]
    return PublishResult(post_id, fetch_permalink(graph, post_id, "permalink_url"))


def stats(graph, post_id: str) -> dict:
    # Metric names per Meta's deprecated-metrics page: post_media_view / post_total_media_view_unique.
    data = graph.get(
        post_id,
        fields="reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
    )
    out = {
        k: data[src]["summary"]["total_count"]
        for k, src in (("likes", "reactions"), ("comments", "comments"))
        if src in data
    }
    if "shares" in data:
        out["shares"] = data["shares"]["count"]
    for key, metric in (("views", "post_media_view"), ("reach", "post_total_media_view_unique")):
        value = insight(graph, post_id, metric)
        if value is not None:
            out[key] = value
    raw = graph.get(
        f"{post_id}/comments",
        fields="from{name},message,like_count,created_time",
        filter="toplevel",
        limit="50",
    )
    out["top_comments"] = [
        {
            "author": (c.get("from") or {}).get("name", ""),
            "text": c.get("message", ""),
            "likes": c.get("like_count", 0),
            "at": c.get("created_time", ""),
        }
        for c in raw.get("data", [])
    ]
    return out
