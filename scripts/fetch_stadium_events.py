"""Fetches REAL upcoming (and recent) events at our 11 stadiums --
since the World Cup itself already happened, the ongoing real source
of stadium events at these same 11 venues is the NFL, which all 11
of them host as their primary tenant (some share with two teams:
SoFi = Rams + Chargers, MetLife = Giants + Jets).

Source: nflverse/nfldata (open, community-maintained, real NFL
schedule + results, 1999-present) --
https://github.com/nflverse/nfldata/blob/master/data/games.csv
Confirmed live this session: the 2026 season file already includes
real FUTURE games (empty `result` field) alongside already-played
ones -- e.g. "2026-09-17 DET @ BUF" had no result yet when fetched,
consistent with today's real date. This is what makes "live/future
event" selection possible at all: World Cup 2026 is over, but these
stadiums' real 2026 NFL season is in progress right now.

kickoff_utc_iso is computed from the file's real gameday+gametime
using each stadium's own real UTC offset -- reused from
data/matches.json (already verified against real September/summer US
daylight-saving offsets for these same 11 venues, unchanged this time
of year).
"""

import csv
import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

TEAM_CODES = {
    "att-stadium": ["DAL"],
    "mercedes-benz-stadium": ["ATL"],
    "gillette-stadium": ["NE"],
    "nrg-stadium": ["HOU"],
    "arrowhead-stadium": ["KC"],
    "sofi-stadium": ["LA", "LAC"],
    "hard-rock-stadium": ["MIA"],
    "metlife-stadium": ["NYG", "NYJ"],
    "lincoln-financial-field": ["PHI"],
    "levis-stadium": ["SF"],
    "lumen-field": ["SEA"],
}

HEADERS = {"User-Agent": "WC26HeatDashboard/1.0 (hackathon research; contact: galamdyq@gmail.com)"}


def main():
    stadiums = json.loads((ROOT / "data" / "stadiums.json").read_text())
    matches = json.loads((ROOT / "data" / "matches.json").read_text())
    utc_offset_by_stadium = {}
    for m in matches:
        utc_offset_by_stadium.setdefault(m["stadium_id"], m["utc_offset"])
    by_id = {s["id"]: s for s in stadiums}

    req = urllib.request.Request(
        "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", headers=HEADERS
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    rows = list(csv.DictReader(text.splitlines()))

    events = []
    for stadium_id, codes in TEAM_CODES.items():
        utc_offset = utc_offset_by_stadium.get(stadium_id)
        stadium = by_id[stadium_id]
        for row in rows:
            if row["season"] != "2026" or row["home_team"] not in codes:
                continue
            if not row["gametime"]:
                continue  # a real game with no announced kickoff time yet -- skip rather than guess
            hh, mm = (int(x) for x in row["gametime"].split(":"))
            y, mo, d = (int(x) for x in row["gameday"].split("-"))
            local_dt = datetime(y, mo, d, hh, mm)
            kickoff_utc = local_dt - timedelta(hours=utc_offset)
            kickoff_utc = kickoff_utc.replace(tzinfo=timezone.utc)
            is_future = row["result"] == ""
            events.append(
                {
                    "match_number": None,
                    "stadium_id": stadium_id,
                    "city": stadium["city"],
                    "round": f"NFL {row['season']} Week {row['week']}",
                    "stage": "nfl",
                    "local_kickoff": f"{hh:02d}:{mm:02d}",
                    "utc_offset": utc_offset,
                    "kickoff_utc_iso": kickoff_utc.isoformat(),
                    "matchup_raw": f"{row['away_team']} @ {row['home_team']}"
                    + (f" ({row['away_score']}-{row['home_score']})" if not is_future else ""),
                    "is_future": is_future,
                    "real_kickoff_temp_c": None,
                    "real_kickoff_dewpoint_c": None,
                    "real_kickoff_wbgt_c": None,
                    "real_peak_wbgt_c": None,
                    "weather_data_status": "MISSING",
                }
            )

    events.sort(key=lambda e: e["kickoff_utc_iso"])
    future_count = sum(1 for e in events if e["is_future"])
    print(f"{len(events)} real NFL 2026 events across 11 stadiums ({future_count} upcoming, not yet played)")
    for sid in TEAM_CODES:
        n = sum(1 for e in events if e["stadium_id"] == sid)
        nf = sum(1 for e in events if e["stadium_id"] == sid and e["is_future"])
        print(f"  {by_id[sid]['name']}: {n} games ({nf} upcoming)")

    with open(ROOT / "data" / "stadium_events.json", "w") as f:
        json.dump(events, f, indent=2)
    print("\nwrote data/stadium_events.json")


if __name__ == "__main__":
    main()
