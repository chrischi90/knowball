import datetime as dt
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import seed_nfl as s  # noqa: E402


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("HB", "RB"), ("FB", "RB"), ("qb", "QB"), ("LEDG", "DE"), ("NT", "DT"), ("DL", "DT"),
        ("OLB", "LB"), ("MLB", "LB"), ("FS", "S"), ("SS", "S"), ("CB", "CB"), ("LB/DE", "LB"),
        ("OL", None), ("T", None), ("K", None), ("LS", None), ("", None), (None, None),
    ],
)
def test_normalize_position(raw, expected):
    assert s.normalize_position(raw) == expected


def test_position_map_matches_js_rules():
    """Python and JS position maps must agree (lib/nfl-rules.js RAW_POSITION_MAP)."""
    js = (Path(__file__).resolve().parents[2] / "lib" / "nfl-rules.js").read_text()
    for raw, canonical in s.RAW_POSITION_MAP.items():
        assert f'{raw}: "{canonical}"' in js, f"{raw} → {canonical} missing from nfl-rules.js"


def test_franchise_ids_follow_relocations():
    assert s.franchise_id("OAK") == "LV"
    assert s.franchise_id("SD") == "LAC"
    assert s.franchise_id("STL") == "LA"
    assert s.franchise_id("KC") == "KC"


def test_season_team_names():
    assert s.season_team_name("LV", "OAK", 2005, "Las Vegas Raiders") == "Oakland Raiders"
    assert s.season_team_name("LV", "LV", 2021, "Las Vegas Raiders") == "Las Vegas Raiders"
    assert s.season_team_name("WAS", "WAS", 2020, "Washington Commanders") == "Washington Football Team"
    assert s.season_team_name("WAS", "WAS", 2023, "Washington Commanders") == "Washington Commanders"


def test_primary_position_ignores_one_off_appearances():
    # RB for 5 seasons with lots of games, listed at QB for one season with 1 game → RB.
    rows = [("p1", 2015 + i, "RB", 16) for i in range(5)] + [("p1", 2020, "QB", 1)]
    assert s.primary_positions(rows)["p1"] == "RB"


def test_primary_position_weights_by_games_and_breaks_ties_by_recency():
    rows = [("p2", 2018, "S", 8), ("p2", 2019, "CB", 8)]
    assert s.primary_positions(rows)["p2"] == "CB"  # tie → most recent
    rows = [("p3", 2018, "TE", 2), ("p3", 2019, "WR", 15)]
    assert s.primary_positions(rows)["p3"] == "WR"


def test_primary_position_offensive_lineman_is_none():
    assert s.primary_positions([("ol", 2020, None, 17)])["ol"] is None


def week(pid, team, season, week_no, season_type="REG", **stats):
    row = {"player_id": pid, "team": team, "season": str(season), "week": str(week_no),
           "season_type": season_type, "player_display_name": "Test Player", "position": "WR"}
    row.update({k: str(v) for k, v in stats.items()})
    return row


def test_aggregate_player_weeks_splits_by_team_and_skips_postseason():
    rows = [
        week("p", "OAK", 2018, 1, receptions=5, receiving_yards=60, targets=8),
        week("p", "OAK", 2018, 2, receptions=3, receiving_yards=40, targets=4, rushing_fumbles_lost=1),
        week("p", "NE", 2018, 10, receptions=7, receiving_yards=100, targets=9),
        week("p", "NE", 2018, 19, season_type="POST", receptions=9, receiving_yards=150),
    ]
    agg = s.aggregate_player_weeks(rows)
    lv = agg[("p", "LV", 2018)]  # OAK mapped to franchise LV
    assert lv["gp"] == 2 and lv["rec"] == 8 and lv["rec_yds"] == 100 and lv["rec_tgt"] == 12
    assert lv["fumbles_lost"] == 1
    ne = agg[("p", "NE", 2018)]
    assert ne["gp"] == 1 and ne["rec_yds"] == 100  # POST row excluded


def test_aggregate_player_weeks_total_tackles_is_solo_plus_assists():
    agg = s.aggregate_player_weeks([week("d", "KC", 2024, 1, def_tackles_solo=4, def_tackle_assists=3)])
    assert agg[("d", "KC", 2024)]["def_tackles"] == 7


def test_team_defense_allowed_comes_from_opponent_offense():
    team_weeks = [
        # KC offense vs BUF defense
        {"season_type": "REG", "team": "KC", "opponent_team": "BUF", "passing_yards": "300",
         "sack_yards_lost": "20", "rushing_yards": "100", "passing_tds": "2", "rushing_tds": "1",
         "attempts": "35", "carries": "25", "sacks_suffered": "3",
         "def_sacks": "2", "def_interceptions": "1", "fumble_recovery_opp": "0"},
        # BUF offense vs KC defense
        {"season_type": "REG", "team": "BUF", "opponent_team": "KC", "passing_yards": "250",
         "sack_yards_lost": "10", "rushing_yards": "80", "passing_tds": "1", "rushing_tds": "0",
         "attempts": "30", "carries": "20", "sacks_suffered": "2",
         "def_sacks": "3", "def_interceptions": "0", "fumble_recovery_opp": "1"},
    ]
    games = [{"season": "2024", "game_type": "REG", "home_team": "KC", "away_team": "BUF",
              "home_score": "27", "away_score": "24"}]
    d = s.aggregate_team_defense(team_weeks, games, 2024)
    assert d["BUF"]["pass_yds_allowed"] == 280  # net of sack yards
    assert d["BUF"]["yards_allowed"] == 380
    assert d["BUF"]["points_allowed"] == 27
    assert d["BUF"]["sacks"] == 3  # BUF's own def_sacks
    assert d["KC"]["points_allowed"] == 24
    assert d["BUF"]["fumbles_recovered"] == 1  # BUF's own recovery
    assert d["KC"]["fumbles_recovered"] == 0
    assert d["KC"]["games"] == 1


def test_team_defense_sack_yards_sign_agnostic():
    """nflverse stores sack_yards_lost as negative; net passing must still subtract it."""
    tw = [{"season_type": "REG", "team": "KC", "opponent_team": "BUF", "passing_yards": "300",
           "sack_yards_lost": "-20", "rushing_yards": "0"}]
    games = [{"season": "2024", "game_type": "REG", "home_team": "KC", "away_team": "BUF",
              "home_score": "1", "away_score": "0"}]
    assert s.aggregate_team_defense(tw, games, 2024)["BUF"]["pass_yds_allowed"] == 280


def test_team_records_handle_ties_unplayed_games_and_relocation():
    games = [
        {"season": "2016", "game_type": "REG", "home_team": "SD", "away_team": "KC", "home_score": "20", "away_score": "20"},
        {"season": "2016", "game_type": "REG", "home_team": "KC", "away_team": "SD", "home_score": "30", "away_score": "10"},
        {"season": "2016", "game_type": "WC", "home_team": "KC", "away_team": "PIT", "home_score": "10", "away_score": "18"},
        {"season": "2026", "game_type": "REG", "home_team": "KC", "away_team": "LAC", "home_score": "", "away_score": ""},
    ]
    r = s.team_records(games)
    assert r[("LAC", 2016)] == {"wins": 0, "losses": 1, "ties": 1, "raw_abbr": "SD"}
    assert r[("KC", 2016)]["wins"] == 1 and r[("KC", 2016)]["ties"] == 1
    assert ("KC", 2026) not in r


def test_parse_madden_page_and_match():
    payload = {"props": {"pageProps": {"ratingDetails": {"totalItems": 2, "items": [
        {"id": 1, "firstName": "Jeremiyah", "lastName": "Love", "overallRating": 82,
         "team": {"label": "Arizona Cardinals"}},
        {"id": 2, "firstName": "Chris", "lastName": "Smith", "overallRating": 70, "team": {"label": "NY Giants"}},
        {"id": 3, "firstName": "Chris", "lastName": "Smith", "overallRating": 65, "team": {"label": "NY Jets"}},
    ]}}}}
    html = f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(payload)}</script></html>'
    items, total = s.parse_madden_page(html)
    assert total == 2 and len(items) == 3
    nick = {"cardinals": "ARI", "giants": "NYG", "jets": "NYJ"}
    rookies = [
        {"player_id": "a", "name": "Jeremiyah Love", "team_id": "ARI"},
        {"player_id": "b", "name": "Chris Smith Jr.", "team_id": "NYJ"},  # suffix + duplicate name
        {"player_id": "c", "name": "Nobody Here", "team_id": "KC"},
    ]
    m = s.match_madden(rookies, items, nick)
    assert m["a"]["id"] == 1
    assert m["b"]["id"] == 3  # team breaks the name tie
    assert "c" not in m


def test_parse_madden_page_fails_loudly_on_structure_change():
    with pytest.raises(ValueError):
        s.parse_madden_page("<html>no data</html>")


def test_current_season():
    assert s.current_season(dt.date(2026, 11, 9)) == 2026
    assert s.current_season(dt.date(2027, 2, 7)) == 2026
    assert s.current_season(dt.date(2027, 6, 1)) == 2027
