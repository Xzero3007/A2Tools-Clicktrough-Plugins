"""Clicktrough's copy of aion2.exchange's market prices, for the Market plugin.

    python3 -I dev/copy_prices.py <folder>

aion2.exchange (https://aion2.exchange, its public API at /api, docs at
/api/docs) collects the market prices players' clients see, a new snapshot
about every hour (~:07). Its server is often briefly down (503 "database
unavailable") and slow, and every meter asking it on its own makes that
worse. So the workflow market-prices.yml runs this once an hour: it asks
aion2.exchange patiently (again and again while it answers 5xx), once per
server, and writes a small file per server into <folder>, which the workflow
publishes on the branch market-data. The Market plugin reads that from
raw.githubusercontent.com (fast, cached by GitHub) and asks aion2.exchange
itself only when the copy lacks its server or is old.

<folder>/servers.json       the servers as /api/servers lists them, each with
                            "copied": whether a prices file is here
<folder>/prices/<id>.json   { v, server, name, faction, region, snapshot,
                            copied, source, items: { "<item id>": [price,
                            listings, units sold, average sold price,
                            change %, last price seen] } } (null: none)
<folder>/history/<id>.json  the lowest listing's course, for the plugins'
                            "usual price" and its anomalies: { v, server,
                            hours: [snapshot, ...] (the last 48), days:
                            ["YYYY-MM-DD", ...] (the last 30), items:
                            { "<item id>": { h: [lowest listing per hour],
                            d: [median of the day's lowest listings] } }
                            } (0: none), kept from the copy before

A server that fails keeps the file it had; when all fail, nothing is
published. MARKET_REGIONS (comma list of
aion2.exchange's region codes, or "all"; default EU) says whose prices to
copy; MARKET_BUDGET_S how long to keep trying (default 1800 s).
"""
import datetime
import json
import statistics
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://aion2.exchange/api"
UA = "A2Tools-DPS-Meter Clicktrough price copy (+https://github.com/Xzero3007/A2Tools-DPS-Meter_Clicktrough)"
REGIONS = [r.strip().upper() for r in os.environ.get("MARKET_REGIONS", "EU").split(",") if r.strip()]
START = time.time()
BUDGET = float(os.environ.get("MARKET_BUDGET_S", "1800"))
PAGE = 1000
HOURS = 48  # hourly points the history keeps
DAYS = 30  # daily medians it keeps


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(path, tries=10):
    """GET a JSON answer, again after a pause while the service fails."""
    for k in range(tries):
        try:
            req = urllib.request.Request(API + path, headers={"Accept": "application/json", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429:
                raise
            wait = min(10 * (k + 1), 60)
            if k == tries - 1 or time.time() - START + wait > BUDGET:
                raise
            print(f"{path}: {e}; again in {wait} s", flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def num(v):
    """A number as JSON keeps it small: whole numbers as int, else 2 places."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return int(f) if f.is_integer() else round(f, 2)


def compact(items):
    """aion2.exchange's item rows -> { "<id>": [price, listings, sold,
    sold average, change %, last price] }, the price null unless listed."""
    out = {}
    for it in items:
        key = it.get("item_key")
        try:
            key = int(key)
        except (TypeError, ValueError):
            continue
        listed = it.get("listed") is not False and (num(it.get("price")) or 0) > 0
        out[str(key)] = [
            num(it.get("price")) if listed else None,
            (num(it.get("listings")) or 0) if listed else 0,
            num(it.get("units_sold")),
            num(it.get("sold_avg_price")),
            num(it.get("change_pct")),
            num(it.get("last_price")),
        ]
    return out


def day_of(iso):
    return str(iso or "")[:10]


def update_history(old, snapshot, items, server_id=None):
    """The history (see the top) with one more snapshot's lowest listings.
    A snapshot it has already (aion2.exchange took no new one) changes
    nothing. The days still whole in the hourly window are worked out again;
    the oldest one, cut by the window, keeps what it had."""
    old = old if isinstance(old, dict) and old.get("v") == 1 else {}
    hours = list(old.get("hours") or [])
    days = list(old.get("days") or [])
    its = old.get("items") or {}
    snap = snapshot or now_iso()
    if hours and hours[-1] >= snap:
        return old
    hours.append(snap)
    width = len(hours)
    h = {}
    for key in set(its) | set(items):
        prev = list((its.get(key) or {}).get("h") or [])
        prev = (prev + [0] * width)[: width - 1]
        row = items.get(key)
        prev.append(int(row[0]) if row and row[0] else 0)
        h[key] = prev
    cut = max(0, len(hours) - HOURS)
    hours = hours[cut:]
    h = {k: v[cut:] for k, v in h.items()}
    d = {k: list((its.get(k) or {}).get("d") or []) for k in h}
    for k in d:
        d[k] = (d[k] + [0] * len(days))[: len(days)]
    first = day_of(hours[0])
    for day in sorted({day_of(x) for x in hours}):
        if day in days and day == first:
            continue  # cut by the window: what it had stays
        if day not in days:
            days.append(day)
            for k in d:
                d[k].append(0)
        at = days.index(day)
        cols = [i for i, x in enumerate(hours) if day_of(x) == day]
        for k, row in h.items():
            vals = [row[i] for i in cols if row[i] > 0]
            d[k][at] = int(statistics.median(vals)) if vals else 0
    keep = max(0, len(days) - DAYS)
    days = days[keep:]
    out = {}
    for k in sorted(h, key=lambda x: int(x) if x.isdigit() else 0):
        dd = d[k][keep:]
        if any(h[k]) or any(dd):
            out[k] = {"h": h[k], "d": dd}
    return {"v": 1, "server": server_id if server_id is not None else old.get("server"), "hours": hours, "days": days, "items": out}


def items_of(server_id):
    """Every item row of a server, page by page."""
    rows = []
    offset = 0
    # By the total it names (it may give fewer per page than asked).
    for _ in range(30):
        res = get(f"/items?server={server_id}&limit={PAGE}&offset={offset}")
        page = res.get("items") or []
        rows += page
        offset += len(page)
        if not page or offset >= (res.get("total") or 0):
            break
        time.sleep(1)
    return rows


def main(folder):
    os.makedirs(os.path.join(folder, "prices"), exist_ok=True)
    os.makedirs(os.path.join(folder, "history"), exist_ok=True)
    res = get("/servers")
    servers = [s for s in res.get("servers") or [] if isinstance(s, dict) and s.get("server_id") is not None]
    wanted = [s for s in servers if s.get("has_data") is not False
              and ("ALL" in REGIONS or str(s.get("region", "")).upper() in REGIONS)]
    print(f"{len(servers)} servers, copying {len(wanted)} ({', '.join(REGIONS)})", flush=True)
    failed = []
    for s in wanted:
        sid = int(s["server_id"])
        try:
            rows = items_of(sid)
        except Exception as e:  # noqa: BLE001 - one server failing keeps its old file
            print(f"{sid} {s.get('name')}: failed ({e}); its old prices stay", flush=True)
            failed.append(sid)
            continue
        items = compact(rows)
        if not items:
            print(f"{sid} {s.get('name')}: no items; its old prices stay", flush=True)
            failed.append(sid)
            continue
        snapshot = max((r.get("captured_at") or "" for r in rows), default="") or None
        doc = {
            "v": 1, "server": sid, "name": s.get("name"), "faction": s.get("faction"), "region": s.get("region"),
            "snapshot": snapshot, "copied": now_iso(), "source": "aion2.exchange", "items": items,
        }
        with open(os.path.join(folder, "prices", f"{sid}.json"), "w", encoding="utf8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        hist_path = os.path.join(folder, "history", f"{sid}.json")
        try:
            with open(hist_path, encoding="utf8") as f:
                old = json.load(f)
        except (OSError, ValueError):
            old = None
        hist = update_history(old, snapshot, items, sid)
        with open(hist_path, "w", encoding="utf8") as f:
            json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
        listed = sum(1 for v in items.values() if v[0] is not None)
        print(f"{sid} {s.get('name')}: {len(items)} items, {listed} listed, snapshot {snapshot}", flush=True)
        time.sleep(1)
    if wanted and len(failed) == len(wanted):
        # Nothing new: the copy stays as it is (no failed run each hour while
        # aion2.exchange is down; the plugin then sees the copy's age).
        print(f"::warning::no server's prices could be copied this time ({len(failed)} failed)", flush=True)
        publish(False)
        return 0
    have = {int(n[:-5]) for n in os.listdir(os.path.join(folder, "prices")) if n.endswith(".json") and n[:-5].isdigit()}
    listing = {
        "v": 1, "copied": now_iso(), "source": "aion2.exchange", "default": res.get("default"),
        "servers": [{**s, "copied": int(s["server_id"]) in have} for s in servers],
    }
    with open(os.path.join(folder, "servers.json"), "w", encoding="utf8") as f:
        json.dump(listing, f, ensure_ascii=False, indent=0)
    with open(os.path.join(folder, "README.md"), "w", encoding="utf8") as f:
        f.write("# Market prices (copy)\n\n"
                "Clicktrough's hourly copy of [aion2.exchange](https://aion2.exchange)'s market prices "
                "(the prices players' clients collect), for the A2Tools meter's Market plugin. Written by "
                "`.github/workflows/market-prices.yml` with the Market plugin's `plugins/market/dev/copy_prices.py` "
                "(Xzero3007/A2Tools-Clicktrough-Plugins); this branch holds one commit, replaced each time.\n\n"
                f"Last copy: {listing['copied']}.\n")
    print(f"done in {time.time() - START:.0f} s, {len(failed)} failed", flush=True)
    publish(True)
    return 0


def publish(yes):
    """Tell the workflow whether there is anything to publish."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf8") as f:
            f.write(f"publish={'true' if yes else 'false'}\n")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
