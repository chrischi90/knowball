import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402


def ctx(y, m, d):
    return main.nba_season_context(dt.date(y, m, d))


def test_early_season_uses_new_rosters_and_last_seasons_stats():
    assert ctx(2026, 11, 10) == {"rosterSeason": "2026-27", "statsSeason": "2025-26"}
    assert ctx(2026, 10, 21) == {"rosterSeason": "2026-27", "statsSeason": "2025-26"}
    assert ctx(2027, 1, 14) == {"rosterSeason": "2026-27", "statsSeason": "2025-26"}


def test_switches_to_current_stats_mid_season():
    assert ctx(2027, 1, 15) == {"rosterSeason": "2026-27", "statsSeason": "2026-27"}
    assert ctx(2027, 4, 1) == {"rosterSeason": "2026-27", "statsSeason": "2026-27"}
    assert ctx(2027, 6, 15) == {"rosterSeason": "2026-27", "statsSeason": "2026-27"}  # Finals


def test_offseason_points_at_upcoming_rosters_and_completed_stats():
    assert ctx(2027, 7, 15) == {"rosterSeason": "2027-28", "statsSeason": "2026-27"}
    assert ctx(2027, 9, 30) == {"rosterSeason": "2027-28", "statsSeason": "2026-27"}


def test_active_seasons_never_points_past_what_is_seeded(monkeypatch):
    monkeypatch.setattr(main, "nba_season_context", lambda today=None: {"rosterSeason": "2027-28", "statsSeason": "2026-27"})
    monkeypatch.setattr(main, "_latest_seeded", lambda table: "2026-27" if table == "roster_players" else "2025-26")
    assert main.active_seasons() == {"rosterSeason": "2026-27", "statsSeason": "2025-26"}
