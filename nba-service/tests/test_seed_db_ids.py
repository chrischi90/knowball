import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import seed_db  # noqa: E402


def test_unknown_player_gets_stable_bref_id():
    exact, norm = {"stephen curry": "201939"}, {}
    assert seed_db.resolve_player_id("Stephen Curry", "curryst01", exact, norm) == "201939"
    assert seed_db.resolve_player_id("AJ Dybantsa", "dybanaj01", exact, norm) == "bref-dybanaj01"
    assert seed_db.resolve_player_id("Nobody", None, exact, norm) is None


def test_existing_bref_id_wins_even_after_nba_api_learns_the_player():
    seed_db._EXISTING_BREF_IDS.add("bref-dybanaj01")
    try:
        exact = {"aj dybantsa": "1642000"}
        assert seed_db.resolve_player_id("AJ Dybantsa", "dybanaj01", exact, {}) == "bref-dybanaj01"
    finally:
        seed_db._EXISTING_BREF_IDS.discard("bref-dybanaj01")


def test_roster_page_parser_captures_slug():
    html = ('<table id="roster"><tr><th data-stat="number">1</th>'
            '<td data-stat="player"><a href="/players/d/dybanaj01.html">AJ Dybantsa</a></td>'
            '<td data-stat="pos" csk="3">SF</td></tr></table>')
    (p,) = seed_db._parse_bref_roster_page(html)
    assert p["name"] == "AJ Dybantsa" and p["slug"] == "dybanaj01" and p["position"] == "SF"


def test_roster_page_parser_handles_single_quoted_hrefs():
    html = ("<table id=\"roster\"><tr><th data-stat=\"number\">7</th>"
            "<td data-stat=\"player\"><a href='/players/d/duranke01.html'>Kevin Durant</a></td>"
            "<td data-stat=\"pos\" csk=\"3\">SF</td></tr></table>")
    (p,) = seed_db._parse_bref_roster_page(html)
    assert p["slug"] == "duranke01"
