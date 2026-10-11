import json

import gspread
from gspread.utils import rowcol_to_a1

from postpilot.config import Config
from postpilot.models import ACCOUNT_COLUMNS, MEDIA_TYPES, POST_COLUMNS, STATUSES, Account, Post

POSTS_TAB = "Posts"
ACCOUNTS_TAB = "Accounts"


class SheetError(Exception):
    """The sheet can't be read or written as expected. Fix the sheet or run init-sheet."""


def _cells(values: list[list[str]], tab: str, required: tuple[str, ...]) -> list[tuple[int, dict[str, str]]]:
    if not values:
        raise SheetError(f"{tab} tab is empty: run init-sheet")
    header = [h.strip() for h in values[0]]
    missing = [c for c in required if c not in header]
    if missing:
        raise SheetError(f"{tab} tab is missing column(s) {', '.join(map(repr, missing))}: run init-sheet")
    rows = []
    for number, row in enumerate(values[1:], start=2):
        if any(v.strip() for v in row):
            rows.append((number, dict(zip(header, row + [""] * (len(header) - len(row)), strict=False))))
    return rows


def posts_from_values(values: list[list[str]], required: tuple[str, ...] = POST_COLUMNS) -> list[Post]:
    return [Post(row=n, cells=cells) for n, cells in _cells(values, POSTS_TAB, required)]


def accounts_from_values(values: list[list[str]]) -> dict[str, Account]:
    accounts = (Account.from_cells(cells) for _, cells in _cells(values, ACCOUNTS_TAB, ACCOUNT_COLUMNS))
    return {a.name: a for a in accounts if a.name}


def cell_updates(header: list[str], updates: dict[int, dict[str, str]]) -> list[dict]:
    data = []
    for row, fields in updates.items():
        for col, value in fields.items():
            if col not in header:
                raise SheetError(f"Posts tab is missing column '{col}': run init-sheet")
            data.append({"range": rowcol_to_a1(row, header.index(col) + 1), "values": [[value]]})
    return data


def init_requests(sheet_id: int, header: list[str]) -> list[dict]:
    """Sheets API requests: dropdowns, publish_at date format, frozen header. Safe to re-run."""

    def column(name: str) -> dict:
        i = header.index(name)
        return {"sheetId": sheet_id, "startRowIndex": 1, "startColumnIndex": i, "endColumnIndex": i + 1}

    requests: list[dict] = [
        {
            "updateSheetProperties": {
                "properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}},
                "fields": "gridProperties.frozenRowCount",
            }
        }
    ]
    for name, options in (("status", STATUSES), ("media_type", MEDIA_TYPES)):
        if name in header:
            rule = {
                "condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": o} for o in options]},
                "showCustomUi": True,
                "strict": True,
            }
            requests.append({"setDataValidation": {"range": column(name), "rule": rule}})
    if "publish_at" in header:
        fmt = {"numberFormat": {"type": "DATE_TIME", "pattern": "yyyy-mm-dd hh:mm"}}
        requests.append(
            {
                "repeatCell": {
                    "range": column("publish_at"),
                    "cell": {"userEnteredFormat": fmt},
                    "fields": "userEnteredFormat.numberFormat",
                }
            }
        )
    return requests


def open_spreadsheet(cfg: Config) -> gspread.Spreadsheet:
    try:
        if cfg.service_account_json:
            client = gspread.service_account_from_dict(json.loads(cfg.service_account_json))
        else:
            client = gspread.service_account(filename=cfg.service_account_file)
        return client.open_by_key(cfg.sheet_id)
    except json.JSONDecodeError:
        raise SheetError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON") from None
    except FileNotFoundError:
        raise SheetError(f"Service account file not found: {cfg.service_account_file}") from None
    except gspread.SpreadsheetNotFound:
        raise SheetError(
            "Sheet not found: check GOOGLE_SHEET_ID and share the sheet with the service account"
        ) from None


class SheetRepository:
    def __init__(self, spreadsheet: gspread.Spreadsheet):
        self.spreadsheet = spreadsheet
        self.header: list[str] = []

    def load(self) -> tuple[list[Post], dict[str, Account]]:
        try:
            ranges = self.spreadsheet.values_batch_get([POSTS_TAB, ACCOUNTS_TAB])["valueRanges"]
        except gspread.exceptions.APIError as e:
            raise SheetError(
                f"Can't read Posts/Accounts tabs ({e.response.status_code}): run init-sheet?"
            ) from None
        posts_values, account_values = (r.get("values", []) for r in ranges)
        self.header = [h.strip() for h in posts_values[0]] if posts_values else []
        return posts_from_values(posts_values), accounts_from_values(account_values)

    def write(self, updates: dict[int, dict[str, str]]) -> None:
        if updates:
            self.spreadsheet.worksheet(POSTS_TAB).batch_update(cell_updates(self.header, updates))


def init_sheet(spreadsheet: gspread.Spreadsheet) -> None:
    existing = {ws.title: ws for ws in spreadsheet.worksheets()}
    requests = []
    for tab, columns in ((POSTS_TAB, POST_COLUMNS), (ACCOUNTS_TAB, ACCOUNT_COLUMNS)):
        ws = existing.get(tab) or spreadsheet.add_worksheet(tab, rows=1000, cols=len(columns))
        header = [h.strip() for h in ws.row_values(1)]
        missing = [c for c in columns if c not in header]
        if missing:
            header += missing
            if ws.col_count < len(header):
                ws.add_cols(len(header) - ws.col_count)
            ws.update([header], "A1")
        requests += init_requests(ws.id, header)
    spreadsheet.batch_update({"requests": requests})
