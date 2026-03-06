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
