CREATE TABLE IF NOT EXISTS teams (
    id           TEXT PRIMARY KEY,
    full_name    TEXT NOT NULL,
    abbreviation TEXT NOT NULL,
    nickname     TEXT NOT NULL,
    city         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roster_players (
    player_id   TEXT NOT NULL,
    team_id     TEXT NOT NULL REFERENCES teams(id),
    season      TEXT NOT NULL,
    player_name TEXT NOT NULL,
    position    TEXT NOT NULL,
    jersey      TEXT,
    PRIMARY KEY (player_id, team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_roster_team_season ON roster_players (team_id, season);

CREATE TABLE IF NOT EXISTS player_season_stats (
    player_id  TEXT NOT NULL,
    team_id    TEXT NOT NULL REFERENCES teams(id),
    season     TEXT NOT NULL,
    gp         INTEGER NOT NULL,
    gs         INTEGER NOT NULL DEFAULT 0,
    minutes    REAL NOT NULL DEFAULT 0,
    pts        REAL NOT NULL,
    reb        REAL NOT NULL,
    ast        REAL NOT NULL,
    stl        REAL NOT NULL,
    blk        REAL NOT NULL,
    fgm        REAL NOT NULL DEFAULT 0,
    fga        REAL NOT NULL DEFAULT 0,
    fg3m       REAL NOT NULL DEFAULT 0,
    fg3a       REAL NOT NULL DEFAULT 0,
    ftm        REAL NOT NULL DEFAULT 0,
    fta        REAL NOT NULL DEFAULT 0,
    tov        REAL NOT NULL DEFAULT 0,
    pf         REAL NOT NULL DEFAULT 0,
    per        REAL,
    ts_pct     REAL,
    three_par  REAL,
    ftr        REAL,
    orb_pct    REAL,
    drb_pct    REAL,
    trb_pct    REAL,
    ast_pct    REAL,
    stl_pct    REAL,
    blk_pct    REAL,
    tov_pct    REAL,
    usg_pct    REAL,
    ows        REAL,
    dws        REAL,
    ws         REAL,
    ws48       REAL,
    obpm       REAL,
    dbpm       REAL,
    bpm        REAL,
    vorp       REAL,
    source     TEXT NOT NULL DEFAULT 'basketball_reference',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (player_id, team_id, season)
);

ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS gs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS minutes REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS fgm REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS fga REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS fg3m REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS fg3a REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS ftm REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS fta REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS tov REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS pf REAL NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS per REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS ts_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS three_par REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS ftr REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS orb_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS drb_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS trb_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS ast_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS stl_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS blk_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS tov_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS usg_pct REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS ows REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS dws REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS ws REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS ws48 REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS obpm REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS dbpm REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS bpm REAL;
ALTER TABLE IF EXISTS player_season_stats ADD COLUMN IF NOT EXISTS vorp REAL;

CREATE INDEX IF NOT EXISTS idx_player_stats_team_season ON player_season_stats (team_id, season);
CREATE INDEX IF NOT EXISTS idx_player_stats_player ON player_season_stats (player_id);
