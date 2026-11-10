import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nfl_router as r  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

DATES = [
    dt.date(2025, 9, 1), dt.date(2025, 9, 2), dt.date(2026, 6, 15), dt.date(2026, 11, 9),
    dt.date(2026, 11, 10), dt.date(2027, 1, 10), dt.date(2027, 1, 13), dt.date(2027, 2, 7),
    dt.date(2027, 3, 1), dt.date(2030, 12, 25),
]


def test_season_context_examples():
    assert r.season_context(dt.date(2026, 11, 9)) == {
        "season": 2026, "phase": "regular", "week": 9, "rosterSeason": 2026, "statsSeason": 2025}
    assert r.season_context(dt.date(2026, 11, 10))["statsSeason"] == 2026
    assert r.season_context(dt.date(2027, 2, 7))["phase"] == "postseason"
    assert r.season_context(dt.date(2026, 6, 15)) == {
        "season": 2026, "phase": "offseason", "week": None, "rosterSeason": 2026, "statsSeason": 2025}


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_season_context_matches_js():
    script = (
        "const r=require('./lib/nfl-rules.js');"
        f"const ds={json.dumps([d.isoformat() for d in DATES])};"
        "console.log(JSON.stringify(ds.map(d=>r.getNflSeasonContext(new Date(d+'T18:00:00Z')))))"
    )
    js = json.loads(subprocess.check_output(["node", "-e", script], cwd=REPO))
    assert [r.season_context(d) for d in DATES] == js


def test_constants_match_js():
    js = (REPO / "lib" / "nfl-rules.js").read_text()
    assert f"const NFL_ALL_TIME_START_SEASON = {r.NFL_ALL_TIME_START_SEASON};" in js
    assert f"const NFL_CURRENT_STATS_START_WEEK = {r.NFL_CURRENT_STATS_START_WEEK};" in js


def row(**kw):
    base = {c: 0 for c in r.STAT_COLUMNS}
    base.update(kw)
    return base


def test_sum_rows_keeps_untracked_stats_null():
    rows = [row(gp=16, rec=80, rec_tgt=None), row(gp=16, rec=90, rec_tgt=None)]
    t = r.sum_rows(rows)
    assert t["gp"] == 32 and t["rec"] == 170 and t["rec_tgt"] is None


def test_sum_rows_partial_nulls_sum_present_values():
    t = r.sum_rows([row(gp=10, def_tackles=None), row(gp=10, def_tackles=50)])
    assert t["def_tackles"] == 50


def test_per_game_line_is_total_over_games():
    t = r.sum_rows([row(gp=16, rush_att=300, rush_yds=1600, rush_td=16, rec=40, rec_yds=320),
                    row(gp=4, rush_att=50, rush_yds=200, rush_td=0)])
    line = r.per_game_line(t, "RB")
    assert line["rushing"]["yds"] == 90.0  # 1800 / 20, not the average of per-game rates
    assert line["receiving"]["rec"] == 2.0
    assert line["passing"] is None and line["defense"] is None


def test_per_game_line_defense_only_for_defenders():
    t = r.sum_rows([row(gp=17, def_tackles=100, def_sacks=10.5)])
    line = r.per_game_line(t, "LB")
    assert line["defense"]["sacks"] == 0.62
    assert line["rushing"] is None and line["receiving"] is None


def test_draft_slot_overall_descends_with_draft_position():
    vals = [r.draft_slot_overall(1, 3), r.draft_slot_overall(1, 25), r.draft_slot_overall(2, 50),
            r.draft_slot_overall(4, 120), r.draft_slot_overall(7, 250), r.draft_slot_overall(None, None)]
    assert vals == sorted(vals, reverse=True)


def test_rookie_percentile_is_capped_by_position():
    assert r.rookie_percentile("QB", 99) == r.ROOKIE_PERCENTILE_CAP["QB"]
    assert r.rookie_percentile("RB", 99) == r.ROOKIE_PERCENTILE_CAP["RB"]
    assert r.ROOKIE_PERCENTILE_CAP["QB"] < r.ROOKIE_PERCENTILE_CAP["RB"]
    assert r.rookie_percentile("WR", 40) == 0.02  # floor


def test_project_rookie_totals_mirrors_bad_stats():
    tables = {"pass_yds": [100, 200, 300], "pass_int": [0.2, 0.6, 1.2]}
    t = r.project_rookie_totals(1.0, tables)
    assert t["pass_yds"] == 300  # top percentile → most yards
    assert t["pass_int"] == 0.2  # …and fewest interceptions
    assert t["rec_tgt"] is None  # no table + nullable


class FakeConn:
    """Minimal psycopg2 stand-in: routes SQL to canned results by substring."""

    def __init__(self, routes):
        self.routes = routes

    def cursor(self):
        return FakeCursor(self.routes)


class FakeCursor:
    def __init__(self, routes):
        self.routes, self.rows, self.description = routes, [], []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        for needle, result in self.routes:
            if needle in sql:
                rows = result(params) if callable(result) else result
                self.description = [(k,) for k in (rows[0].keys() if rows else [])]
                self.rows = [tuple(x.values()) for x in rows]
                return
        self.rows, self.description = [], []

    def fetchall(self):
        return self.rows


def make_client(routes):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(r.create_nfl_router(lambda: FakeConn(routes), lambda c: None))
    return TestClient(app)


def test_router_teams_and_404s():
    pytest.importorskip("httpx")
    client = make_client([
        ("FROM nfl_teams", [{"id": "KC", "full_name": "Kansas City Chiefs", "abbreviation": "KC",
                             "conference": "AFC", "division": "AFC West"}]),
    ])
    assert client.get("/nfl/teams").json()["teams"][0]["fullName"] == "Kansas City Chiefs"
    assert client.get("/nfl/teams/XXX/players?game_mode=active_only").status_code == 404
    assert client.get("/nfl/teams/XXX/defense?season=2020").status_code == 404


def test_router_db_error_is_502():
    pytest.importorskip("httpx")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    def broken():
        raise RuntimeError("db down")

    app = FastAPI()
    app.include_router(r.create_nfl_router(broken, lambda c: None))
    assert TestClient(app).get("/nfl/teams").status_code == 502


def test_per_game_uses_only_games_where_stat_was_tracked():
    # 10 games with targets tracked (60 targets), 10 games in an untracked era.
    t = r.sum_rows([row(gp=10, rec=40, rec_tgt=60), row(gp=10, rec=40, rec_tgt=None)])
    line = r.per_game_line(t, "TE")
    assert line["receiving"]["rec"] == 4.0   # 80 / 20 games
    assert line["receiving"]["tgt"] == 6.0   # 60 / 10 tracked games, not 60 / 20
