from postpilot.graph import fetch_permalink
from postpilot.models import Account, Post, PublishResult


def publish(graph, account: Account, post: Post) -> PublishResult:
    caption, link, urls = post.get("caption"), post.get("link"), post.media_urls
    if urls:
        # Photo posts have no link field, so the link goes in the caption.
        text = "\n\n".join(t for t in (caption, link) if t)
        response = graph.post(f"{account.fb_page_id}/photos", safe=False, url=urls[0], caption=text)
        post_id = response.get("post_id") or response["id"]
    else:
        fields = {"message": caption, **({"link": link} if link else {})}
        post_id = graph.post(f"{account.fb_page_id}/feed", safe=False, **fields)["id"]
    return PublishResult(post_id, fetch_permalink(graph, post_id, "permalink_url"))
