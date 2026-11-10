"""copy_prices.update_history: the hourly window, the days' medians, a
snapshot seen before. python3 -I dev/tests/test_history.py"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import copy_prices as cp  # noqa: E402


def snap(day, hour):
    return f"2026-11-{day:02d}T{hour:02d}:07:00Z"


def main():
    h = None
    # Two days, an item at 100 by day and 300 on the second, one gone after a while.
    for day in (1, 2):
        for hour in range(24):
            items = {"1": [100 * (1 if day == 1 else 3), 4, None, None, 0, 0]}
            if day == 1 and hour < 5:
                items["2"] = [50, 1, None, None, 0, 0]
            h = cp.update_history(h, snap(day, hour), items, 12305)
    assert h["hours"][0] == snap(1, 0) and len(h["hours"]) == 48
    assert h["days"] == ["2026-11-01", "2026-11-02"]
    assert h["items"]["1"]["d"] == [100, 300]
    assert h["items"]["2"]["d"] == [50, 0]
    assert h["items"]["2"]["h"][:6] == [50] * 5 + [0]
    # The same snapshot again: nothing changes.
    assert cp.update_history(h, snap(2, 23), {"1": [999, 1]}) is h
    # A third day pushes the first out of the hourly window; its median stays.
    for hour in range(3):
        h = cp.update_history(h, snap(3, hour), {"1": [200, 1]}, 12305)
    assert len(h["hours"]) == 48 and h["hours"][0] == snap(1, 3)
    assert h["items"]["1"]["d"] == [100, 300, 200]
    # Item 2 is gone from the hourly window only after its hours pass.
    assert "2" in h["items"]
    # 40 days: 30 kept.
    for day in range(4, 44):
        at = datetime.datetime(2026, 11, 1) + datetime.timedelta(days=day - 1)
        h = cp.update_history(h, at.strftime("%Y-%m-%dT00:07:00Z"), {"1": [day, 1]})
    assert len(h["days"]) == 30 and h["items"]["1"]["d"][-1] == 43
    assert all(len(v["d"]) == 30 and len(v["h"]) == len(h["hours"]) for v in h["items"].values())
    print("history: ok")


if __name__ == "__main__":
    main()
