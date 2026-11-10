-- NFL schema. Lives alongside the NBA tables (schema.sql); all tables are nfl_-prefixed.
-- Idempotent: safe to apply repeatedly.
--
-- Conventions
--   Source    = nflverse (github.com/nflverse/nflverse-data), 1999+. 1980-1998 to be backfilled
--               later from manually exported PFR CSVs.
--   team_id   = current nflverse franchise abbreviation (e.g. 'KC', 'LV', 'LA'), stable across
--               relocations: OAK→LV, SD→LAC, STL→LA. Historical names live in nfl_team_seasons.
--   player_id = NFL gsis id (e.g. '00-0033873'), the id nflverse stats use. pfr_id is kept on
--               nfl_players for linking the PFR backfill.
--   season    = INTEGER start year (the 2025 season = 2025, even though it ends Feb 2026).
--   Stats are stored as season TOTALS; the service computes per-game values as
--   SUM(totals) / SUM(games) across the seasons in scope.
--   position columns hold the canonical primary position (QB RB WR TE DE DT LB CB S DB);
--   see lib/nfl-rules.js normalizeNflPosition.

CREATE TABLE IF NOT EXISTS nfl_teams (
    id           TEXT PRIMARY KEY,
    full_name    TEXT NOT NULL,          -- current name
    abbreviation TEXT NOT NULL,          -- current abbreviation, e.g. 'KC'
    conference   TEXT NOT NULL CHECK (conference IN ('AFC', 'NFC')),
    division     TEXT NOT NULL           -- e.g. 'AFC West'
);

-- One row per franchise-season. Drives the all_time TEAM DEFENSE season picker
-- and historical display names (e.g. 2005 'Oakland Raiders').
CREATE TABLE IF NOT EXISTS nfl_team_seasons (
    team_id    TEXT    NOT NULL REFERENCES nfl_teams(id),
    season     INTEGER NOT NULL,
    team_name  TEXT    NOT NULL,
    wins       INTEGER NOT NULL,
    losses     INTEGER NOT NULL,
    ties       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, season)
);

CREATE TABLE IF NOT EXISTS nfl_players (
    player_id    TEXT PRIMARY KEY,
    pfr_id       TEXT,
    player_name  TEXT NOT NULL,
    -- Career primary position: the position listed most, weighted by games played.
    -- One-off appearances elsewhere don't count. NULL = not a game position (OL/K/P/LS).
    primary_position TEXT,
    birth_date   DATE,
    college      TEXT,
    draft_year   INTEGER,
    draft_round  INTEGER,
    draft_pick   INTEGER,               -- overall pick
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Who was on which team each season. For the current season this is refreshed
-- regularly so active_only always shows up-to-date rosters.
CREATE TABLE IF NOT EXISTS nfl_roster_players (
    player_id     TEXT    NOT NULL REFERENCES nfl_players(player_id),
    team_id       TEXT    NOT NULL REFERENCES nfl_teams(id),
    season        INTEGER NOT NULL,
    player_name   TEXT    NOT NULL,
    position      TEXT    NOT NULL,     -- player's career primary position (copied from nfl_players)
    raw_position  TEXT,                 -- as listed that season, e.g. 'OLB'
    jersey        TEXT,
    PRIMARY KEY (player_id, team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_nfl_roster_team_season ON nfl_roster_players (team_id, season);
CREATE INDEX IF NOT EXISTS idx_nfl_roster_team_position ON nfl_roster_players (team_id, position);

CREATE TABLE IF NOT EXISTS nfl_player_season_stats (
    player_id          TEXT    NOT NULL REFERENCES nfl_players(player_id),
    team_id            TEXT    NOT NULL REFERENCES nfl_teams(id),
    season             INTEGER NOT NULL,
    position           TEXT    NOT NULL, -- primary position that season
    gp                 INTEGER NOT NULL,
    gs                 INTEGER NOT NULL DEFAULT 0,
    -- passing
    pass_cmp           INTEGER NOT NULL DEFAULT 0,
    pass_att           INTEGER NOT NULL DEFAULT 0,
    pass_yds           INTEGER NOT NULL DEFAULT 0,
    pass_td            INTEGER NOT NULL DEFAULT 0,
    pass_int           INTEGER NOT NULL DEFAULT 0,
    pass_sacked        INTEGER NOT NULL DEFAULT 0,
    -- rushing
    rush_att           INTEGER NOT NULL DEFAULT 0,
    rush_yds           INTEGER NOT NULL DEFAULT 0,
    rush_td            INTEGER NOT NULL DEFAULT 0,
    fumbles_lost       INTEGER NOT NULL DEFAULT 0,
    -- receiving
    rec_tgt            INTEGER,          -- NULL before targets were tracked (1992)
    rec                INTEGER NOT NULL DEFAULT 0,
    rec_yds            INTEGER NOT NULL DEFAULT 0,
    rec_td             INTEGER NOT NULL DEFAULT 0,
    -- defense (NULL = not tracked that era, distinct from 0)
    def_tackles        INTEGER,
    def_sacks          REAL,             -- half sacks; official from 1982
    def_int            INTEGER NOT NULL DEFAULT 0,
    def_pass_defended  INTEGER,
    def_forced_fumbles INTEGER,
    def_tfl            INTEGER,
    source             TEXT      NOT NULL DEFAULT 'nflverse',
    updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (player_id, team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_nfl_stats_team_season ON nfl_player_season_stats (team_id, season);
CREATE INDEX IF NOT EXISTS idx_nfl_stats_player ON nfl_player_season_stats (player_id);

CREATE TABLE IF NOT EXISTS nfl_team_defense_season_stats (
    team_id             TEXT    NOT NULL REFERENCES nfl_teams(id),
    season              INTEGER NOT NULL,
    games               INTEGER NOT NULL,
    points_allowed      INTEGER NOT NULL,
    yards_allowed       INTEGER NOT NULL,
    plays_allowed       INTEGER,
    pass_yds_allowed    INTEGER NOT NULL,
    pass_td_allowed     INTEGER,
    rush_yds_allowed    INTEGER NOT NULL,
    rush_td_allowed     INTEGER,
    interceptions       INTEGER NOT NULL DEFAULT 0,
    fumbles_recovered   INTEGER NOT NULL DEFAULT 0,
    sacks               REAL,            -- NULL when not tracked (pre-1982 backfill)
    source              TEXT      NOT NULL DEFAULT 'nflverse',
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, season),
    FOREIGN KEY (team_id, season) REFERENCES nfl_team_seasons (team_id, season)
);

-- Madden ratings for current rookies (used ONLY for rookie projections before week 10).
-- Scraped from ea.com/games/madden-nfl/ratings?rookie=true (page __NEXT_DATA__), plus
-- draft slot (nflverse draft_picks) as the fallback input when a rookie has no Madden rating.
CREATE TABLE IF NOT EXISTS nfl_rookie_profiles (
    player_id        TEXT    NOT NULL REFERENCES nfl_players(player_id),
    season           INTEGER NOT NULL,   -- rookie season
    team_id          TEXT    REFERENCES nfl_teams(id),
    position         TEXT    NOT NULL,   -- canonical primary position
    madden_id        INTEGER,            -- NULL when not found in Madden
    madden_overall   INTEGER,
    madden_attributes JSONB,             -- e.g. {"speed": 92, "awareness": 70, "throwPower": 88}
    madden_iteration TEXT,               -- e.g. 'Week 8 Ratings'
    draft_round      INTEGER,
    draft_pick       INTEGER,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_nfl_rookie_team ON nfl_rookie_profiles (team_id, season);
