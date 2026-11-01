"""免費新聞來源（RSS / 公開 JSON）+ 關鍵字標籤。"""
from __future__ import annotations

import calendar
import hashlib
import re
from datetime import datetime, timezone

import feedparser

from sources import _get

FEEDS = [
    ("CNBC 經濟", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
    ("CNBC 市場", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("Google News", "https://news.google.com/rss/search?q=Fed+OR+inflation+OR+Treasury+yields+OR+semiconductor+when:1d&hl=en-US&gl=US&ceid=US:en"),
    ("Google 新聞", "https://news.google.com/rss/search?q=%E5%8F%B0%E8%82%A1+OR+%E5%8F%B0%E7%A9%8D%E9%9B%BB+OR+%E5%A4%AE%E8%A1%8C+when:1d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"),
]

CNYES = "https://api.cnyes.com/media/api/v1/newslist/category/headline"

# 標籤：(標籤名, regex)；英文用字邊界避免誤判
TAGS = [
    ("FED", r"\bfed\b|fomc|powell|warsh|federal reserve|rate cut|rate hike|聯準會|降息|升息|央行|鮑爾|華許"),
    ("通膨", r"inflation|\bcpi\b|\bpce\b|\bppi\b|prices rose|通膨|物價|消費者物價"),
    ("就業", r"payroll|jobs report|unemployment|jobless|labor market|非農|就業|失業"),
    ("地緣政治", r"war\b|missile|sanction|tariff|geopolit|iran|israel|ukraine|russia|taiwan strait|china.*tension|戰爭|制裁|關稅|地緣|衝突"),
    ("半導體", r"semiconductor|chip|nvidia|tsmc|\bamd\b|broadcom|asml|micron|\bai\b|半導體|晶片|台積電|輝達|AI"),
    ("能源", r"\boil\b|crude|opec|brent|natural gas|原油|油價|石油"),
    ("匯率", r"dollar|yen|\bboj\b|currency|forex|美元|日圓|匯率|新台幣|日銀"),
    ("債市", r"treasury|yield|bond|殖利率|公債|債券"),
    ("加密", r"bitcoin|crypto|\bbtc\b|ethereum|stablecoin|比特幣|加密"),
    ("台股", r"taiex|台股|加權指數|櫃買|外資"),
    ("中國", r"china|beijing|yuan|pboc|中國|人民幣|陸股"),
]
_TAG_RE = [(t, re.compile(p, re.I)) for t, p in TAGS]


def tag(title: str):
    return [t for t, rx in _TAG_RE if rx.search(title)]


def _ts(entry):
    for k in ("published_parsed", "updated_parsed"):
        if entry.get(k):
            return calendar.timegm(entry[k])
    return None


def _one(src, url):
    items = []
    r = _get(url, retries=1)
    feed = feedparser.parse(r.content)
    for e in feed.entries[:25]:
        title = (e.get("title") or "").strip()
        if not title:
            continue
        # Google News 標題結尾帶「 - 媒體名」
        pub = src
        if src.startswith("Google") and " - " in title:
            title, pub = title.rsplit(" - ", 1)
        items.append({"title": title, "url": e.get("link"), "source": pub,
                      "t": _ts(e), "tags": tag(title)})
    return items


def fetch_news(limit=80):
    from concurrent.futures import ThreadPoolExecutor
    items, errors = [], []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {src: ex.submit(_one, src, url) for src, url in FEEDS}
        for src, f in futs.items():
            try:
                items += f.result()
            except Exception as e:  # noqa: BLE001
                errors.append(f"{src}: {e}")
    try:
        r = _get(CNYES, params={"limit": 30}, retries=1)
        for n in r.json()["items"]["data"]:
            title = n.get("title", "").strip()
            items.append({"title": title, "url": f"https://news.cnyes.com/news/id/{n['newsId']}",
                          "source": "鉅亨網", "t": n.get("publishAt"), "tags": tag(title)})
    except Exception as ex:  # noqa: BLE001
        errors.append(f"鉅亨網: {ex}")

    # 去重（標題 hash）並依時間排序
    seen, out = set(), []
    for it in sorted(items, key=lambda x: x["t"] or 0, reverse=True):
        h = hashlib.md5(re.sub(r"\W+", "", it["title"].lower()).encode()).hexdigest()
        if h in seen:
            continue
        seen.add(h)
        out.append(it)
    return {"updated": int(datetime.now(timezone.utc).timestamp()), "items": out[:limit], "errors": errors}
