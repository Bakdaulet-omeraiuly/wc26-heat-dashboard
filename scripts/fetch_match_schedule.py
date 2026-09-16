"""Fetches the REAL FIFA World Cup 2026 match schedule from the
openfootball/worldcup open dataset (Football.TXT format, plain text,
MIT-style open data project) and extracts every match played at one of
our 11 US stadiums.

Because the tournament (June 11 - July 19, 2026) has already been
played as of this session (today is September 2026), this dataset
includes real final scores too -- not a prediction. We only use the
date/time/venue fields; scores are kept as a raw display string for
color, not used in any calculation.

Source files (real, fetched live, not vendored):
  https://raw.githubusercontent.com/openfootball/worldcup/master/2026--canada-usa-mexico/cup.txt          (group stage)
  https://raw.githubusercontent.com/openfootball/worldcup/master/2026--canada-usa-mexico/cup_finals.txt   (knockout stage)

Writes data/matches.json: a list of real matches at our 11 stadiums,
each with a real UTC kickoff timestamp (computed from the file's own
"HH:MM UTC-N" fields -- verified against known kickoff times, e.g. the
July 1 Atlanta match's 12:00 UTC-4 = 8:00am local, consistent with an
early World Cup slot).
"""

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STADIUMS = json.loads((ROOT / "data" / "stadiums.json").read_text())

# Map each stadium's city PREFIX (as it appears before the state/comma
# in stadiums.json) to its stadium id -- openfootball's city field
# matches this prefix exactly for every one of our 11 venues (verified
# by inspection of both files).
CITY_TO_STADIUM = {s["city"].split(",")[0].strip(): s["id"] for s in STADIUMS}

SOURCES = [
    ("https://raw.githubusercontent.com/openfootball/worldcup/master/2026--canada-usa-mexico/cup.txt", "group"),
    ("https://raw.githubusercontent.com/openfootball/worldcup/master/2026--canada-usa-mexico/cup_finals.txt", "knockout"),
]

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "june": 6,
    "jul": 7, "july": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

DATE_RE = re.compile(r"^[A-Z][a-z]+ ([A-Za-z]+)\.? (\d{1,2})\s*$")
SECTION_RE = re.compile(r"^▪\s*(.+?)\s*(?:\||$)")
MATCH_RE = re.compile(
    r"^\s*(?:\((?P<num>\d+)\)\s*)?"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})\s*UTC(?P<utc_off>[+-]\d+)\s+"
    r"(?P<matchup>.+?)\s*@\s*(?P<city>[^#]+?)\s*(?:##.*)?$"
)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "WC26HeatDashboard/1.0 (hackathon research)"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8")


def parse_file(text: str, kind: str):
    matches = []
    current_date = None  # (year, month, day)
    current_section = None
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()

        sec = SECTION_RE.match(stripped)
        if sec:
            current_section = sec.group(1)
            continue

        dm = DATE_RE.match(stripped)
        if dm:
            month_str, day_str = dm.group(1).lower(), dm.group(2)
            month = MONTHS.get(month_str)
            if month:
                current_date = (2026, month, int(day_str))
            continue

        mm = MATCH_RE.match(line)
        if mm and current_date:
            city = mm.group("city").strip()
            stadium_id = CITY_TO_STADIUM.get(city)
            if not stadium_id:
                continue  # a match at a Mexico/Canada venue, or unmatched city -- not one of our 11
            year, month, day = current_date
            hour, minute = int(mm.group("hour")), int(mm.group("minute"))
            utc_off = int(mm.group("utc_off"))
            # "HH:MM UTC-4" means local kickoff HH:MM in a zone that is
            # UTC-4 -- so the real UTC instant is local time MINUS the
            # offset (i.e. + 4 hours for UTC-4).
            utc_dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc) - __import__("datetime").timedelta(hours=utc_off)
            matches.append(
                {
                    "match_number": int(mm.group("num")) if mm.group("num") else None,
                    "stadium_id": stadium_id,
                    "city": city,
                    "round": current_section,
                    "stage": kind,
                    "local_kickoff": f"{hour:02d}:{minute:02d}",
                    "utc_offset": utc_off,
                    "kickoff_utc_iso": utc_dt.isoformat(),
                    "matchup_raw": mm.group("matchup").strip(),
                }
            )
    return matches


def main():
    all_matches = []
    for url, kind in SOURCES:
        text = fetch(url)
        found = parse_file(text, kind)
        print(f"{url.split('/')[-1]}: {len(found)} matches at our 11 stadiums")
        all_matches.extend(found)

    all_matches.sort(key=lambda m: m["kickoff_utc_iso"])
    by_stadium = {}
    for m in all_matches:
        by_stadium.setdefault(m["stadium_id"], 0)
        by_stadium[m["stadium_id"]] += 1
    print("\nmatches per stadium:")
    for s in STADIUMS:
        print(f"  {s['name']}: {by_stadium.get(s['id'], 0)}")
    print(f"\ntotal: {len(all_matches)} real matches at our 11 US venues (source: openfootball/worldcup, REAL, already-played results)")

    with open(ROOT / "data" / "matches.json", "w") as f:
        json.dump(all_matches, f, indent=2)
    print("\nwrote data/matches.json")


if __name__ == "__main__":
    main()
