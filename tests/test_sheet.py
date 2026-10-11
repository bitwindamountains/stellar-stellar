import pytest

from postpilot.sheet import SheetError, accounts_from_values, cell_updates, init_requests, posts_from_values


def test_posts_skip_blank_rows_and_keep_row_numbers():
    values = [["account", "caption"], ["main", "one"], ["", " "], ["main", "three"]]
    posts = posts_from_values(values, required=("account", "caption"))
    assert [(p.row, p.get("caption")) for p in posts] == [(2, "one"), (4, "three")]


def test_short_rows_are_padded():
    posts = posts_from_values([["account", "caption"], ["main"]], required=("account", "caption"))
    assert posts[0].get("caption") == ""


def test_missing_required_column_names_it():
    with pytest.raises(SheetError, match="'caption'.*init-sheet"):
        posts_from_values([["account"]], required=("account", "caption"))


def test_empty_tab_is_an_error():
    with pytest.raises(SheetError, match="Posts tab is empty"):
        posts_from_values([], required=("account",))


def test_accounts_keyed_by_name_skipping_blanks():
    values = [
        ["account", "fb_page_id", "ig_user_id", "token_env", "timezone"],
        ["main", "1", "2", "T", ""],
        ["", "", "", "", ""],
    ]
    accounts = accounts_from_values(values)
    assert list(accounts) == ["main"]
    assert accounts["main"].timezone == "Asia/Manila"


def test_cell_updates_use_header_positions():
    header = ["account", "status", "fb_post_id"]
    assert cell_updates(header, {5: {"fb_post_id": "1_2", "status": "posted"}}) == [
        {"range": "C5", "values": [["1_2"]]},
        {"range": "B5", "values": [["posted"]]},
    ]


def test_cell_updates_unknown_column():
    with pytest.raises(SheetError, match="'posted_at'"):
        cell_updates(["account"], {2: {"posted_at": "x"}})


def test_init_requests_add_dropdowns_format_and_freeze():
    header = ["account", "publish_at", "status", "media_type"]
    reqs = init_requests(sheet_id=7, header=header)
    kinds = [next(iter(r)) for r in reqs]
    assert kinds.count("setDataValidation") == 2
    assert "repeatCell" in kinds and "updateSheetProperties" in kinds
    fmt = next(r["repeatCell"] for r in reqs if "repeatCell" in r)
    assert fmt["range"]["startColumnIndex"] == 1
    assert fmt["cell"]["userEnteredFormat"]["numberFormat"]["pattern"] == "yyyy-mm-dd hh:mm"
